//! Storage for explicit favorite synchronization.
//!
//! The userscript owns remote requests and reconciliation. A baseline revision
//! prevents an older observation from overwriting a newer favorite action.

use std::collections::HashSet;

use axum::{
    Json,
    extract::{Path, Query, State, rejection::JsonRejection},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::SqliteConnection;

use crate::{
    ids::{PostId, parse_id_list},
    posts::{Tag, replace_tags},
    server::{AppError, AppResult, AppState},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileRequest {
    ids: Vec<PostId>,
    #[serde(default)]
    deleted: Vec<PostId>,
    reported_count: i64,
    revision: i64,
}

#[derive(Deserialize)]
pub struct MembershipRequest {
    membership: Membership,
}

#[derive(Deserialize)]
pub struct ObservationRequest {
    tags: Vec<Tag>,
}

#[derive(Deserialize)]
pub struct AvailabilityRequest {
    availability: Availability,
}

#[derive(Deserialize)]
pub struct PostStatusQuery {
    #[serde(deserialize_with = "deserialize_ids")]
    ids: Vec<PostId>,
}

fn deserialize_ids<'de, D>(deserializer: D) -> Result<Vec<PostId>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = String::deserialize(deserializer)?;
    parse_id_list(&raw).map_err(serde::de::Error::custom)
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

pub async fn get_status(
    State(AppState { database, .. }): State<AppState>,
) -> AppResult<Json<Value>> {
    let mut transaction = database.pool.begin().await?;
    let response = status(&mut transaction).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

pub async fn get_baseline(
    State(AppState { database, .. }): State<AppState>,
) -> AppResult<Json<Value>> {
    let mut transaction = database.pool.begin().await?;
    let response = baseline(&mut transaction).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

pub async fn reconcile_favorites(
    State(AppState { database, .. }): State<AppState>,
    payload: Result<Json<ReconcileRequest>, JsonRejection>,
) -> AppResult<Json<Value>> {
    let Json(request) = parse_json(payload)?;
    let mut transaction = database.pool.begin_with("BEGIN IMMEDIATE").await?;
    let response = reconcile(
        &mut transaction,
        &request.ids,
        &request.deleted,
        request.reported_count,
        request.revision,
    )
    .await?;
    transaction.commit().await?;
    Ok(Json(response))
}

pub async fn get_post_status(
    State(AppState { database, .. }): State<AppState>,
    Query(query): Query<PostStatusQuery>,
) -> AppResult<Json<Value>> {
    let mut transaction = database.pool.begin().await?;
    let response = memberships(&mut transaction, &query.ids).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

pub async fn get_pending_posts(
    State(AppState { database, .. }): State<AppState>,
) -> AppResult<Json<Value>> {
    let mut transaction = database.pool.begin().await?;
    let response = pending_downloads(&mut transaction).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

pub async fn set_post_membership(
    State(AppState { database, .. }): State<AppState>,
    Path(post_id): Path<PostId>,
    payload: Result<Json<MembershipRequest>, JsonRejection>,
) -> AppResult<Json<Value>> {
    let Json(request) = parse_json(payload)?;
    let mut transaction = database.pool.begin_with("BEGIN IMMEDIATE").await?;
    let response = set_membership(&mut transaction, post_id, &request.membership).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

pub async fn observe_post_details(
    State(AppState { database, .. }): State<AppState>,
    Path(post_id): Path<PostId>,
    payload: Result<Json<ObservationRequest>, JsonRejection>,
) -> AppResult<Json<Value>> {
    let Json(request) = parse_json(payload)?;
    let mut transaction = database.pool.begin_with("BEGIN IMMEDIATE").await?;
    let response = observe_post(&mut transaction, post_id, &request.tags).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

pub async fn update_post_availability(
    State(AppState { database, .. }): State<AppState>,
    Path(post_id): Path<PostId>,
    payload: Result<Json<AvailabilityRequest>, JsonRejection>,
) -> AppResult<Json<Value>> {
    let Json(request) = parse_json(payload)?;
    let mut transaction = database.pool.begin_with("BEGIN IMMEDIATE").await?;
    let response = set_availability(&mut transaction, post_id, &request.availability).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

fn parse_json<T>(payload: Result<Json<T>, JsonRejection>) -> AppResult<Json<T>> {
    payload.map_err(|error| AppError::bad_request(error.body_text()))
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
    Ok(json!({"postIds": ids}))
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
        posts.push(json!({
            "postId": post_id,
            "membership": if row.favorited { "favorited" } else { "unfavorited" },
            "availability": row.availability,
            "downloaded": row.downloaded,
        }));
    }
    Ok(json!({"posts": posts}))
}

#[cfg(test)]
mod tests;
