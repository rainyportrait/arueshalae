use anyhow::{Result, anyhow, ensure};
use serde_json::{Value, json};
use sqlx::{Row, SqliteConnection};

use crate::ids::PostId;

use super::{Command, ok};

pub(super) async fn update_membership(
    connection: &mut SqliteConnection,
    post_id: PostId,
    membership: &str,
) -> Result<()> {
    ensure!(
        post_id.0 > 0 && matches!(membership, "favorited" | "unfavorited"),
        "invalid membership"
    );

    let previous: Option<String> =
        sqlx::query_scalar("SELECT membership FROM favorites WHERE post_id = ?")
            .bind(post_id)
            .fetch_optional(&mut *connection)
            .await?;

    sqlx::query("INSERT INTO posts (post_id) VALUES (?) ON CONFLICT DO NOTHING")
        .bind(post_id)
        .execute(&mut *connection)
        .await?;

    sqlx::query(
        r#"INSERT INTO favorites (
            post_id,
            membership,
            membership_checked_at
        ) VALUES (?, ?, unixepoch())
        ON CONFLICT (post_id) DO UPDATE SET
            membership = excluded.membership,
            membership_checked_at = excluded.membership_checked_at"#,
    )
    .bind(post_id)
    .bind(membership)
    .execute(&mut *connection)
    .await?;

    if membership != "favorited" {
        return Ok(());
    }

    sqlx::query(
        r#"UPDATE posts
        SET availability = 'unknown'
        WHERE post_id = ? AND availability = 'deleted'"#,
    )
    .bind(post_id)
    .execute(&mut *connection)
    .await?;

    sqlx::query(
        r#"INSERT INTO download_queue (post_id)
        SELECT ?
        WHERE NOT EXISTS (
            SELECT 1 FROM post_media WHERE post_id = ?
        )
        ON CONFLICT DO NOTHING"#,
    )
    .bind(post_id)
    .bind(post_id)
    .execute(&mut *connection)
    .await?;

    if previous.as_deref() != Some("favorited") {
        sqlx::query(
            r#"UPDATE download_queue
            SET attempt_count = 0,
                next_attempt_at = 0,
                last_error = NULL
            WHERE post_id = ?"#,
        )
        .bind(post_id)
        .execute(connection)
        .await?;
    }

    Ok(())
}

pub(super) async fn library(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    ensure!(
        matches!(command.value.as_str(), "active" | "archived" | "all"),
        "invalid library filter"
    );

    let rows = sqlx::query(
        r#"SELECT
            p.post_id,
            p.availability,
            f.membership,
            m.post_id IS NOT NULL AS downloaded
        FROM posts p
        JOIN favorites f USING (post_id)
        LEFT JOIN post_media m USING (post_id)
        WHERE ? = 'all'
           OR (? = 'archived' AND f.membership = 'unfavorited')
           OR (
                ? = 'active'
                AND f.membership != 'unfavorited'
                AND (
                    f.membership = 'favorited'
                    OR p.availability = 'deleted'
                )
           )
        ORDER BY
            f.last_known_position IS NULL,
            f.last_known_position,
            p.post_id DESC
        LIMIT 50 OFFSET ?"#,
    )
    .bind(&command.value)
    .bind(&command.value)
    .bind(&command.value)
    .bind(command.position.max(0))
    .fetch_all(connection)
    .await?;

    let posts = rows
        .iter()
        .map(|row| {
            json!({
                "postId": row.get::<PostId, _>("post_id"),
                "availability": row.get::<String, _>("availability"),
                "membership": row.get::<String, _>("membership"),
                "downloaded": row.get::<bool, _>("downloaded"),
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({"posts": posts}))
}

pub(super) async fn memberships(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    let mut posts = Vec::new();

    for post_id in &command.ids {
        let row = sqlx::query(
            r#"SELECT
                f.membership,
                p.availability,
                m.post_id IS NOT NULL AS downloaded,
                q.attempt_count,
                q.last_error,
                EXISTS (
                    SELECT 1
                    FROM worker_leases
                    WHERE worker_kind = 'download'
                      AND current_post_id = f.post_id
                      AND expires_at > unixepoch()
                ) AS downloading
            FROM favorites f
            JOIN posts p USING (post_id)
            LEFT JOIN post_media m USING (post_id)
            LEFT JOIN download_queue q USING (post_id)
            WHERE f.post_id = ?"#,
        )
        .bind(post_id)
        .fetch_optional(&mut *connection)
        .await?;

        let Some(row) = row else {
            continue;
        };

        let downloaded = row.get::<bool, _>("downloaded");
        let availability = row.get::<String, _>("availability");
        let membership = row.get::<String, _>("membership");
        let downloading = row.get::<bool, _>("downloading");
        let attempts = row
            .get::<Option<i64>, _>("attempt_count")
            .unwrap_or_default();
        let download_state = match () {
            _ if downloaded => "downloaded",
            _ if availability == "deleted" => "unavailable",
            _ if membership != "favorited" => "not queued",
            _ if downloading => "downloading",
            _ if attempts >= 5 => "failed",
            _ => "queued",
        };

        posts.push(json!({
            "postId": post_id,
            "membership": membership,
            "availability": availability,
            "downloaded": downloaded,
            "error": row.get::<Option<String>, _>("last_error"),
            "downloadState": download_state,
        }));
    }

    Ok(json!({"posts": posts}))
}

pub(super) async fn status(connection: &mut SqliteConnection) -> Result<Value> {
    let account = sqlx::query("SELECT * FROM sync_account")
        .fetch_one(&mut *connection)
        .await?;
    let counts = sqlx::query(
        r#"SELECT
            (
                SELECT COUNT(*)
                FROM favorites f
                JOIN posts p USING (post_id)
                WHERE membership = 'favorited'
                  AND availability != 'deleted'
            ) AS active,
            (SELECT COUNT(*) FROM post_media) AS downloaded,
            (
                SELECT COUNT(*)
                FROM favorites
                WHERE membership = 'unfavorited'
            ) AS archived,
            (
                SELECT COUNT(*)
                FROM posts
                WHERE availability = 'deleted'
            ) AS deleted,
            (
                SELECT COUNT(*)
                FROM download_queue q
                JOIN favorites f USING (post_id)
                JOIN posts p USING (post_id)
                WHERE membership = 'favorited'
                  AND availability != 'deleted'
                  AND attempt_count < 5
            ) AS pending"#,
    )
    .fetch_one(&mut *connection)
    .await?;
    let run = sqlx::query(
        r#"SELECT *
        FROM sync_runs
        ORDER BY sync_run_id DESC
        LIMIT 1"#,
    )
    .fetch_optional(connection)
    .await?;

    Ok(json!({
        "reconciliationPaused": account.get::<bool, _>("reconciliation_paused"),
        "downloadsPaused": account.get::<bool, _>("downloads_paused"),
        "budget": account.get::<i64, _>("request_budget"),
        "baseline": account.get::<Option<i64>, _>("baseline_run_id"),
        "active": counts.get::<i64, _>("active"),
        "downloaded": counts.get::<i64, _>("downloaded"),
        "archived": counts.get::<i64, _>("archived"),
        "deleted": counts.get::<i64, _>("deleted"),
        "pending": counts.get::<i64, _>("pending"),
        "run": run.map(|row| json!({
            "id": row.get::<i64, _>("sync_run_id"),
            "status": row.get::<String, _>("status"),
            "checkpoint": row.get::<i64, _>("checkpoint"),
            "message": row.get::<Option<String>, _>("message"),
        })),
    }))
}

pub(super) async fn set_membership(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    let post_id = command.post_id.ok_or_else(|| anyhow!("missing post"))?;
    update_membership(connection, post_id, &command.value).await?;

    sqlx::query(
        r#"UPDATE sync_account
        SET membership_revision = membership_revision + 1,
            next_check_at = 0"#,
    )
    .execute(connection)
    .await?;

    Ok(ok())
}

pub(super) async fn set_budget(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    ensure!(
        (1..=1000).contains(&command.count),
        "request budget must be between 1 and 1000"
    );

    sqlx::query("UPDATE sync_account SET request_budget = ?")
        .bind(command.count)
        .execute(connection)
        .await?;

    Ok(ok())
}

pub(super) async fn set_pause(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    let statement = match command.worker.as_str() {
        "download" => "UPDATE sync_account SET downloads_paused = ?",
        "reconciliation" => "UPDATE sync_account SET reconciliation_paused = ?",
        _ => return Err(anyhow!("invalid worker")),
    };

    sqlx::query(statement)
        .bind(command.value == "true")
        .execute(connection)
        .await?;

    Ok(ok())
}

pub(super) async fn retry_downloads(connection: &mut SqliteConnection) -> Result<Value> {
    sqlx::query(
        r#"UPDATE download_queue
        SET attempt_count = 0,
            next_attempt_at = 0,
            last_error = NULL"#,
    )
    .execute(connection)
    .await?;

    Ok(ok())
}

pub(super) async fn queue_full_scan(connection: &mut SqliteConnection) -> Result<Value> {
    let exists: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
            SELECT 1
            FROM sync_runs
            WHERE kind = 'full'
              AND status IN ('pending', 'running')
        )"#,
    )
    .fetch_one(&mut *connection)
    .await?;

    if !exists {
        sqlx::query(
            r#"INSERT INTO sync_runs (kind, revision)
            SELECT 'full', membership_revision
            FROM sync_account"#,
        )
        .execute(connection)
        .await?;
    }

    Ok(ok())
}

pub(super) async fn cancel_full_scan(connection: &mut SqliteConnection) -> Result<Value> {
    sqlx::query(
        r#"UPDATE sync_runs
        SET status = 'cancelled',
            finished_at = unixepoch()
        WHERE status IN ('pending', 'running')"#,
    )
    .execute(connection)
    .await?;

    Ok(ok())
}
