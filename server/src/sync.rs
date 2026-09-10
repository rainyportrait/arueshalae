//! Storage for explicit favorite synchronization.
//!
//! The userscript owns remote requests and reconciliation. A baseline revision
//! prevents an older observation from overwriting a newer favorite action.

use std::collections::HashSet;

use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::SqliteConnection;

use crate::{
    database::Database,
    ids::PostId,
    posts::{Tag, replace_tags},
    server::{AppError, AppResult, AppState},
};

#[derive(Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    Status,
    Baseline,
    Reconcile {
        ids: Vec<PostId>,
        #[serde(default)]
        deleted: Vec<PostId>,
        reported_count: i64,
        revision: i64,
    },
    Membership {
        post_id: PostId,
        value: Membership,
    },
    Memberships {
        ids: Vec<PostId>,
    },
    Observation {
        post_id: PostId,
        tags: Vec<Tag>,
    },
    Downloads,
    Availability {
        post_id: PostId,
        value: Availability,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Membership {
    Favorited,
    Unfavorited,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Availability {
    Available,
    Deleted,
}

pub async fn command(
    State(AppState { database, .. }): State<AppState>,
    payload: Result<Json<Command>, JsonRejection>,
) -> AppResult<Json<Value>> {
    let Json(command) = payload.map_err(|error| AppError::bad_request(error.body_text()))?;
    Ok(Json(execute(&database, &command).await?))
}

async fn execute(database: &Database, command: &Command) -> AppResult<Value> {
    let read_only = matches!(
        command,
        Command::Status | Command::Baseline | Command::Memberships { .. } | Command::Downloads
    );
    let mut transaction = if read_only {
        database.pool.begin().await?
    } else {
        database.pool.begin_with("BEGIN IMMEDIATE").await?
    };

    let result = match command {
        Command::Status => status(&mut transaction).await?,
        Command::Baseline => baseline(&mut transaction).await?,
        Command::Reconcile {
            ids,
            deleted,
            reported_count,
            revision,
        } => reconcile(&mut transaction, ids, deleted, *reported_count, *revision).await?,
        Command::Membership { post_id, value } => {
            set_membership(&mut transaction, *post_id, value).await?
        }
        Command::Memberships { ids } => memberships(&mut transaction, ids).await?,
        Command::Observation { post_id, tags } => {
            observe_post(&mut transaction, *post_id, tags).await?
        }
        Command::Downloads => pending_downloads(&mut transaction).await?,
        Command::Availability { post_id, value } => {
            set_availability(&mut transaction, *post_id, value).await?
        }
    };

    transaction.commit().await?;
    Ok(result)
}

async fn observe_post(
    connection: &mut SqliteConnection,
    post_id: PostId,
    tags: &[Tag],
) -> AppResult<Value> {
    validate_ids(&[post_id])?;
    let favorited = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM favorite_order WHERE post_id = ?) AS "exists!: bool""#,
        post_id.0
    )
    .fetch_one(&mut *connection)
    .await?;
    if !favorited {
        return Ok(json!({"observed": false}));
    }

    set_post_availability(connection, post_id, &Availability::Available).await?;
    replace_tags(connection, post_id, tags).await?;
    Ok(json!({"observed": true}))
}

async fn status(connection: &mut SqliteConnection) -> AppResult<Value> {
    let state = sqlx::query!("SELECT initialized, count_offset, last_sync_at FROM sync_state")
        .fetch_one(&mut *connection)
        .await?;
    let counts = sqlx::query!(
        r#"SELECT
            (SELECT COUNT(*) FROM favorite_order) AS favorites,
            (SELECT COUNT(*) FROM posts p
             JOIN favorite_order f USING (post_id)
             LEFT JOIN post_media m USING (post_id)
             WHERE p.availability != 'deleted' AND m.post_id IS NULL) AS pending"#
    )
    .fetch_one(&mut *connection)
    .await?;

    Ok(json!({
        "favorites": counts.favorites,
        "pending": counts.pending,
        "initialized": state.initialized,
        "countOffset": state.count_offset,
        "lastSyncAt": state.last_sync_at,
    }))
}

async fn baseline(connection: &mut SqliteConnection) -> AppResult<Value> {
    let ids = sqlx::query_scalar!(
        r#"SELECT post_id AS "post_id: PostId" FROM favorite_order ORDER BY position"#
    )
    .fetch_all(&mut *connection)
    .await?;
    let state = sqlx::query!("SELECT initialized, count_offset, revision FROM sync_state")
        .fetch_one(connection)
        .await?;

    Ok(json!({
        "ids": ids,
        "initialized": state.initialized,
        "countOffset": state.count_offset,
        "revision": state.revision,
    }))
}

async fn reconcile(
    connection: &mut SqliteConnection,
    ids: &[PostId],
    deleted: &[PostId],
    reported_count: i64,
    revision: i64,
) -> AppResult<Value> {
    validate_order(ids)?;
    validate_ids(deleted)?;
    if reported_count < 0 {
        return Err(AppError::bad_request("invalid reported count"));
    }
    let current = ids.iter().copied().collect::<HashSet<_>>();
    if deleted.iter().any(|post_id| current.contains(post_id)) {
        return Err(AppError::bad_request(
            "a current favorite cannot be deleted",
        ));
    }

    let state = sqlx::query!("SELECT initialized, revision FROM sync_state")
        .fetch_one(&mut *connection)
        .await?;
    if state.revision != revision {
        return Err(AppError::conflict(
            "Favorites changed during synchronization; run Sync again",
        ));
    }

    for post_id in ids {
        ensure_post(connection, *post_id).await?;
        restore_favorite_availability(connection, *post_id).await?;
    }
    for post_id in deleted {
        ensure_post(connection, *post_id).await?;
        set_post_availability(connection, *post_id, &Availability::Deleted).await?;
    }
    replace_order(connection, ids).await?;

    if state.initialized {
        sqlx::query!("UPDATE sync_state SET last_sync_at = unixepoch(), revision = revision + 1")
            .execute(connection)
            .await?;
    } else {
        let offset = reported_count - ids.len() as i64;
        sqlx::query!(
            r#"UPDATE sync_state
            SET initialized = 1, count_offset = ?, last_sync_at = unixepoch(),
                revision = revision + 1"#,
            offset
        )
        .execute(connection)
        .await?;
    }
    Ok(json!({"ok": true}))
}

async fn set_membership(
    connection: &mut SqliteConnection,
    post_id: PostId,
    membership: &Membership,
) -> AppResult<Value> {
    validate_ids(&[post_id])?;
    match membership {
        Membership::Favorited => prepend_favorite(connection, post_id).await?,
        Membership::Unfavorited => {
            sqlx::query!("DELETE FROM favorite_order WHERE post_id = ?", post_id.0)
                .execute(&mut *connection)
                .await?;
        }
    }
    sqlx::query!("UPDATE sync_state SET revision = revision + 1")
        .execute(connection)
        .await?;
    Ok(json!({"ok": true}))
}

async fn prepend_favorite(connection: &mut SqliteConnection, post_id: PostId) -> AppResult<()> {
    ensure_post(connection, post_id).await?;
    restore_favorite_availability(connection, post_id).await?;

    // Positions are ordering keys, not contiguous array indexes. Existing rows
    // keep their positions when another favorite is added or removed.
    sqlx::query!("DELETE FROM favorite_order WHERE post_id = ?", post_id.0)
        .execute(&mut *connection)
        .await?;
    sqlx::query!(
        r#"INSERT INTO favorite_order (position, post_id)
        SELECT COALESCE(MIN(position), 1) - 1, ? FROM favorite_order"#,
        post_id.0
    )
    .execute(connection)
    .await?;
    Ok(())
}

async fn restore_favorite_availability(
    connection: &mut SqliteConnection,
    post_id: PostId,
) -> AppResult<()> {
    sqlx::query!(
        r#"UPDATE posts SET availability = 'unknown'
        WHERE post_id = ? AND availability = 'deleted'"#,
        post_id.0
    )
    .execute(connection)
    .await?;
    Ok(())
}

async fn replace_order(connection: &mut SqliteConnection, ids: &[PostId]) -> AppResult<()> {
    sqlx::query!("DELETE FROM favorite_order")
        .execute(&mut *connection)
        .await?;
    for (position, post_id) in ids.iter().enumerate() {
        let position = position as i64;
        sqlx::query!(
            "INSERT INTO favorite_order (position, post_id) VALUES (?, ?)",
            position,
            post_id.0
        )
        .execute(&mut *connection)
        .await?;
    }
    Ok(())
}

fn validate_ids(ids: &[PostId]) -> AppResult<()> {
    if ids.iter().any(|id| id.0 <= 0) {
        return Err(AppError::bad_request("post IDs must be positive"));
    }
    Ok(())
}

fn validate_order(ids: &[PostId]) -> AppResult<()> {
    validate_ids(ids)?;
    if ids.iter().copied().collect::<HashSet<_>>().len() != ids.len() {
        return Err(AppError::bad_request("favorite order contains duplicates"));
    }
    Ok(())
}

async fn ensure_post(connection: &mut SqliteConnection, post_id: PostId) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO posts (post_id) VALUES (?) ON CONFLICT DO NOTHING",
        post_id.0
    )
    .execute(connection)
    .await?;
    Ok(())
}

async fn pending_downloads(connection: &mut SqliteConnection) -> AppResult<Value> {
    let ids = sqlx::query_scalar!(
        r#"SELECT f.post_id AS "post_id: PostId"
        FROM favorite_order f
        JOIN posts p USING (post_id)
        LEFT JOIN post_media m USING (post_id)
        WHERE p.availability != 'deleted' AND m.post_id IS NULL
        ORDER BY f.position"#
    )
    .fetch_all(connection)
    .await?;
    Ok(json!({"ids": ids}))
}

async fn set_availability(
    connection: &mut SqliteConnection,
    post_id: PostId,
    availability: &Availability,
) -> AppResult<Value> {
    validate_ids(&[post_id])?;
    ensure_post(connection, post_id).await?;
    set_post_availability(connection, post_id, availability).await?;
    Ok(json!({"ok": true}))
}

async fn set_post_availability(
    connection: &mut SqliteConnection,
    post_id: PostId,
    availability: &Availability,
) -> AppResult<()> {
    let availability = match availability {
        Availability::Available => "available",
        Availability::Deleted => "deleted",
    };
    sqlx::query!(
        "UPDATE posts SET availability = ?, details_checked_at = unixepoch() WHERE post_id = ?",
        availability,
        post_id.0
    )
    .execute(connection)
    .await?;
    Ok(())
}

async fn memberships(connection: &mut SqliteConnection, ids: &[PostId]) -> AppResult<Value> {
    validate_ids(ids)?;
    let mut posts = Vec::new();
    for post_id in ids {
        let row = sqlx::query!(
            r#"SELECT p.availability,
                      f.post_id IS NOT NULL AS "favorited!: bool",
                      m.post_id IS NOT NULL AS "downloaded!: bool"
            FROM posts p
            LEFT JOIN favorite_order f USING (post_id)
            LEFT JOIN post_media m USING (post_id)
            WHERE p.post_id = ?"#,
            post_id.0
        )
        .fetch_optional(&mut *connection)
        .await?;
        let Some(row) = row else { continue };
        let state = if row.downloaded {
            "downloaded"
        } else if row.availability == "deleted" {
            "unavailable"
        } else if row.favorited {
            "missing"
        } else {
            "not queued"
        };
        posts.push(json!({
            "postId": post_id,
            "membership": if row.favorited { "favorited" } else { "unfavorited" },
            "availability": row.availability,
            "downloaded": row.downloaded,
            "downloadState": state,
            "error": Value::Null,
        }));
    }
    Ok(json!({"posts": posts}))
}

#[cfg(test)]
mod tests;
