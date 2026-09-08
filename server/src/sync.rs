//! Storage for explicit favorite synchronization.
//!
//! The userscript owns every rule34 request and the reconciliation algorithm.
//! The server only stores the complete result and downloaded media.

use std::collections::HashSet;

use anyhow::{Result, bail, ensure};
use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, SqliteConnection};

use crate::{
    database::Database,
    ids::PostId,
    server::{AppResult, AppState},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    action: String,
    #[serde(default)]
    post_id: Option<PostId>,
    #[serde(default)]
    ids: Vec<PostId>,
    #[serde(default)]
    deleted: Vec<PostId>,
    #[serde(default)]
    reported_count: i64,
    #[serde(default)]
    value: String,
}

pub async fn command(
    State(AppState { database, .. }): State<AppState>,
    Json(command): Json<Command>,
) -> AppResult<Json<Value>> {
    Ok(Json(execute(&database, &command).await?))
}

async fn execute(database: &Database, command: &Command) -> Result<Value> {
    let mut transaction = database.pool.begin_with("BEGIN IMMEDIATE").await?;
    let result = match command.action.as_str() {
        "status" => status(&mut transaction).await?,
        "baseline" => baseline(&mut transaction).await?,
        "reconcile" => reconcile(&mut transaction, command).await?,
        "membership" => set_membership(&mut transaction, command).await?,
        "memberships" => memberships(&mut transaction, command).await?,
        "downloads" => pending_downloads(&mut transaction).await?,
        "availability" => set_availability(&mut transaction, command).await?,
        _ => bail!("unknown sync command"),
    };
    transaction.commit().await?;
    Ok(result)
}

async fn status(connection: &mut SqliteConnection) -> Result<Value> {
    let state = sqlx::query("SELECT initialized, count_offset, last_sync_at FROM sync_state")
        .fetch_one(&mut *connection)
        .await?;
    let counts = sqlx::query(
        r#"SELECT
          (SELECT COUNT(*) FROM favorite_order) AS favorites,
          (SELECT COUNT(*) FROM posts p
             JOIN favorite_order f USING (post_id)
             LEFT JOIN post_media m USING (post_id)
            WHERE p.availability != 'deleted' AND m.post_id IS NULL) AS pending"#,
    )
    .fetch_one(&mut *connection)
    .await?;

    Ok(json!({
        "favorites": counts.get::<i64, _>("favorites"),
        "pending": counts.get::<i64, _>("pending"),
        "initialized": state.get::<bool, _>("initialized"),
        "countOffset": state.get::<i64, _>("count_offset"),
        "lastSyncAt": state.get::<Option<i64>, _>("last_sync_at"),
    }))
}

async fn baseline(connection: &mut SqliteConnection) -> Result<Value> {
    let ids: Vec<PostId> =
        sqlx::query_scalar("SELECT post_id FROM favorite_order ORDER BY position")
            .fetch_all(&mut *connection)
            .await?;
    let state = sqlx::query("SELECT initialized, count_offset FROM sync_state")
        .fetch_one(connection)
        .await?;
    Ok(json!({
        "ids": ids,
        "initialized": state.get::<bool, _>("initialized"),
        "countOffset": state.get::<i64, _>("count_offset"),
    }))
}

async fn reconcile(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    validate_order(&command.ids)?;
    ensure!(command.reported_count >= 0, "invalid reported count");
    let current = command.ids.iter().copied().collect::<HashSet<_>>();
    ensure!(
        command
            .deleted
            .iter()
            .all(|post_id| !current.contains(post_id)),
        "a current favorite cannot be deleted"
    );

    for post_id in &command.ids {
        ensure_post(connection, *post_id).await?;
        sqlx::query(
            "UPDATE posts SET availability = 'unknown' WHERE post_id = ? AND availability = 'deleted'",
        )
        .bind(post_id)
        .execute(&mut *connection)
        .await?;
    }
    for post_id in &command.deleted {
        ensure_post(connection, *post_id).await?;
        set_post_availability(connection, *post_id, "deleted").await?;
    }

    replace_order(connection, &command.ids).await?;
    let initialized: bool = sqlx::query_scalar("SELECT initialized FROM sync_state")
        .fetch_one(&mut *connection)
        .await?;
    if initialized {
        sqlx::query("UPDATE sync_state SET last_sync_at = unixepoch()")
            .execute(connection)
            .await?;
    } else {
        let offset = command.reported_count - command.ids.len() as i64;
        sqlx::query(
            "UPDATE sync_state SET initialized = 1, count_offset = ?, last_sync_at = unixepoch()",
        )
        .bind(offset)
        .execute(connection)
        .await?;
    }
    Ok(ok())
}

async fn set_membership(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let post_id = command
        .post_id
        .ok_or_else(|| anyhow::anyhow!("missing post"))?;
    match command.value.as_str() {
        "favorited" => prepend_favorite(connection, post_id).await?,
        "unfavorited" => {
            sqlx::query("DELETE FROM favorite_order WHERE post_id = ?")
                .bind(post_id)
                .execute(&mut *connection)
                .await?;
            compact_order(connection).await?;
        }
        _ => bail!("invalid membership"),
    }
    Ok(ok())
}

async fn prepend_favorite(connection: &mut SqliteConnection, post_id: PostId) -> Result<()> {
    ensure_post(connection, post_id).await?;
    sqlx::query(
        "UPDATE posts SET availability = 'unknown' WHERE post_id = ? AND availability = 'deleted'",
    )
    .bind(post_id)
    .execute(&mut *connection)
    .await?;
    let mut ids: Vec<PostId> =
        sqlx::query_scalar("SELECT post_id FROM favorite_order ORDER BY position")
            .fetch_all(&mut *connection)
            .await?;
    ids.retain(|existing| *existing != post_id);
    ids.insert(0, post_id);
    replace_order(connection, &ids).await
}

async fn replace_order(connection: &mut SqliteConnection, ids: &[PostId]) -> Result<()> {
    sqlx::query("DELETE FROM favorite_order")
        .execute(&mut *connection)
        .await?;
    for (position, post_id) in ids.iter().enumerate() {
        sqlx::query("INSERT INTO favorite_order (position, post_id) VALUES (?, ?)")
            .bind(position as i64)
            .bind(post_id)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

async fn compact_order(connection: &mut SqliteConnection) -> Result<()> {
    let ids: Vec<PostId> =
        sqlx::query_scalar("SELECT post_id FROM favorite_order ORDER BY position")
            .fetch_all(&mut *connection)
            .await?;
    replace_order(connection, &ids).await
}

fn validate_order(ids: &[PostId]) -> Result<()> {
    ensure!(ids.iter().all(|id| id.0 > 0), "invalid post id");
    ensure!(
        ids.iter().copied().collect::<HashSet<_>>().len() == ids.len(),
        "favorite order contains duplicates"
    );
    Ok(())
}

async fn ensure_post(connection: &mut SqliteConnection, post_id: PostId) -> Result<()> {
    sqlx::query("INSERT INTO posts (post_id) VALUES (?) ON CONFLICT DO NOTHING")
        .bind(post_id)
        .execute(connection)
        .await?;
    Ok(())
}

async fn pending_downloads(connection: &mut SqliteConnection) -> Result<Value> {
    let ids: Vec<PostId> = sqlx::query_scalar(
        r#"SELECT f.post_id
        FROM favorite_order f
        JOIN posts p USING (post_id)
        LEFT JOIN post_media m USING (post_id)
        WHERE p.availability != 'deleted' AND m.post_id IS NULL
        ORDER BY f.position"#,
    )
    .fetch_all(connection)
    .await?;
    Ok(json!({"ids": ids}))
}

async fn set_availability(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let post_id = command
        .post_id
        .ok_or_else(|| anyhow::anyhow!("missing post"))?;
    ensure_post(connection, post_id).await?;
    set_post_availability(connection, post_id, &command.value).await?;
    Ok(ok())
}

async fn set_post_availability(
    connection: &mut SqliteConnection,
    post_id: PostId,
    availability: &str,
) -> Result<()> {
    ensure!(
        matches!(availability, "available" | "deleted"),
        "invalid availability"
    );
    sqlx::query(
        "UPDATE posts SET availability = ?, details_checked_at = unixepoch() WHERE post_id = ?",
    )
    .bind(availability)
    .bind(post_id)
    .execute(connection)
    .await?;
    Ok(())
}

async fn memberships(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let mut posts = Vec::new();
    for post_id in &command.ids {
        let row = sqlx::query(
            r#"SELECT p.availability,
                      f.post_id IS NOT NULL AS favorited,
                      m.post_id IS NOT NULL AS downloaded
            FROM posts p
            LEFT JOIN favorite_order f USING (post_id)
            LEFT JOIN post_media m USING (post_id)
            WHERE p.post_id = ?"#,
        )
        .bind(post_id)
        .fetch_optional(&mut *connection)
        .await?;
        let Some(row) = row else { continue };
        let favorited = row.get::<bool, _>("favorited");
        let downloaded = row.get::<bool, _>("downloaded");
        let availability = row.get::<String, _>("availability");
        let state = if downloaded {
            "downloaded"
        } else if availability == "deleted" {
            "unavailable"
        } else if favorited {
            "missing"
        } else {
            "not queued"
        };
        posts.push(json!({
            "postId": post_id,
            "membership": if favorited { "favorited" } else { "unfavorited" },
            "availability": availability,
            "downloaded": downloaded,
            "downloadState": state,
            "error": Value::Null,
        }));
    }
    Ok(json!({"posts": posts}))
}

fn ok() -> Value {
    json!({"ok": true})
}

#[cfg(test)]
mod tests {
    use super::{Command, execute, validate_order};
    use crate::{database::Database, ids::PostId};
    use camino::Utf8Path;

    #[test]
    fn order_rejects_duplicates() {
        assert!(validate_order(&[PostId(1), PostId(1)]).is_err());
    }

    #[tokio::test]
    async fn reconciliation_initializes_offset_and_replaces_order() {
        let directory = tempfile::tempdir().unwrap();
        let path = Utf8Path::from_path(directory.path())
            .unwrap()
            .join("test.db");
        let database = Database::new(&path).await.unwrap();
        let mut first = command("reconcile");
        first.ids = vec![PostId(30), PostId(20), PostId(10)];
        first.reported_count = 5;
        execute(&database, &first).await.unwrap();
        let baseline = execute(&database, &command("baseline")).await.unwrap();
        assert_eq!(baseline["countOffset"], 2);
        assert_eq!(baseline["ids"], serde_json::json!([30, 20, 10]));

        let mut second = command("reconcile");
        second.ids = vec![PostId(40), PostId(30), PostId(10)];
        second.deleted = vec![PostId(20)];
        second.reported_count = 100;
        execute(&database, &second).await.unwrap();
        let baseline = execute(&database, &command("baseline")).await.unwrap();
        assert_eq!(baseline["countOffset"], 2);
        assert_eq!(baseline["ids"], serde_json::json!([40, 30, 10]));
    }

    fn command(action: &str) -> Command {
        Command {
            action: action.to_string(),
            post_id: None,
            ids: Vec::new(),
            deleted: Vec::new(),
            reported_count: 0,
            value: String::new(),
        }
    }
}
