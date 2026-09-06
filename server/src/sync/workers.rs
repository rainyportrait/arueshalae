use anyhow::{Result, ensure};
use serde_json::{Value, json};
use sqlx::SqliteConnection;

use crate::ids::PostId;

use super::{Command, ok};

pub(super) async fn acquire_lease(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    ensure!(
        matches!(command.worker.as_str(), "download" | "reconciliation")
            && !command.owner.is_empty(),
        "invalid worker"
    );

    let generation: Option<i64> = sqlx::query_scalar(
        r#"INSERT INTO worker_leases (
            worker_kind,
            owner_token,
            generation,
            expires_at,
            last_progress_at
        ) VALUES (?, ?, 1, unixepoch() + 60, unixepoch())
        ON CONFLICT (worker_kind) DO UPDATE SET
            owner_token = excluded.owner_token,
            generation = worker_leases.generation + 1,
            expires_at = excluded.expires_at,
            last_progress_at = excluded.last_progress_at
        WHERE worker_leases.expires_at <= unixepoch()
        RETURNING generation"#,
    )
    .bind(&command.worker)
    .bind(&command.owner)
    .fetch_optional(connection)
    .await?;

    Ok(json!({"generation": generation}))
}

pub(super) async fn renew_lease(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    let changed = sqlx::query(
        r#"UPDATE worker_leases
        SET expires_at = unixepoch() + 60,
            last_progress_at = CASE
                WHEN ? THEN unixepoch()
                ELSE last_progress_at
            END
        WHERE worker_kind = ?
          AND owner_token = ?
          AND generation = ?
          AND expires_at > unixepoch()
          AND (? OR last_progress_at > unixepoch() - 600)"#,
    )
    .bind(command.progress)
    .bind(&command.worker)
    .bind(&command.owner)
    .bind(command.generation)
    .bind(command.progress)
    .execute(connection)
    .await?
    .rows_affected();

    Ok(json!({"ok": changed == 1}))
}

pub(super) async fn release_lease(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    sqlx::query(
        r#"UPDATE worker_leases
        SET expires_at = 0,
            current_post_id = NULL
        WHERE worker_kind = ?
          AND owner_token = ?
          AND generation = ?"#,
    )
    .bind(&command.worker)
    .bind(&command.owner)
    .bind(command.generation)
    .execute(connection)
    .await?;

    Ok(ok())
}

pub(super) async fn pace(connection: &mut SqliteConnection) -> Result<Value> {
    let request_at: i64 = sqlx::query_scalar(
        r#"UPDATE background_pacing
        SET next_request_at = MAX(
            next_request_at,
            CAST(unixepoch('subsec') * 1000 AS INTEGER)
        ) + 350
        RETURNING next_request_at - 350"#,
    )
    .fetch_one(&mut *connection)
    .await?;
    let now: i64 = sqlx::query_scalar("SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER)")
        .fetch_one(connection)
        .await?;

    Ok(json!({"wait": (request_at - now).max(0)}))
}

pub(super) async fn next_download(connection: &mut SqliteConnection) -> Result<Value> {
    let post_id: Option<PostId> = sqlx::query_scalar(
        r#"SELECT q.post_id
        FROM download_queue q
        JOIN favorites f USING (post_id)
        JOIN posts p USING (post_id)
        LEFT JOIN post_media m USING (post_id)
        WHERE f.membership = 'favorited'
          AND p.availability != 'deleted'
          AND m.post_id IS NULL
          AND q.attempt_count < 5
          AND q.next_attempt_at <= unixepoch()
        ORDER BY q.next_attempt_at, q.post_id DESC
        LIMIT 1"#,
    )
    .fetch_optional(&mut *connection)
    .await?;

    sqlx::query(
        r#"UPDATE worker_leases
        SET current_post_id = ?
        WHERE worker_kind = 'download'"#,
    )
    .bind(post_id)
    .execute(connection)
    .await?;

    Ok(json!({"postId": post_id}))
}

pub(super) async fn record_download_failure(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    let error = command.value.chars().take(1000).collect::<String>();

    sqlx::query(
        r#"UPDATE download_queue
        SET attempt_count = attempt_count + 1,
            next_attempt_at = unixepoch() + MIN(86400, 60 * (1 << attempt_count)),
            last_error = ?
        WHERE post_id = ?"#,
    )
    .bind(error)
    .bind(command.post_id)
    .execute(connection)
    .await?;

    Ok(ok())
}

pub(super) async fn set_availability(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    ensure!(
        matches!(command.value.as_str(), "available" | "deleted"),
        "invalid availability"
    );

    sqlx::query(
        r#"UPDATE posts
        SET availability = ?,
            details_checked_at = unixepoch()
        WHERE post_id = ?"#,
    )
    .bind(&command.value)
    .bind(command.post_id)
    .execute(connection)
    .await?;

    Ok(ok())
}
