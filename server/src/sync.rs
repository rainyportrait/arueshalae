//! Storage and atomic coordination for favorite synchronization.
//!
//! The userscript owns every rule34 request and the reconciliation algorithm.
//! This module stores the resulting facts; it never performs upstream work.

use std::collections::HashSet;

use anyhow::{Result, bail, ensure};
use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, SqliteConnection};

use crate::{
    database::Database,
    ids::{PostId, Rule34UserId},
    server::{AppResult, AppState},
};

const INCREMENTAL_INTERVAL_SECONDS: i64 = 15 * 60;
const DOWNLOAD_CLAIM_SECONDS: i64 = 5 * 60;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    user_id: Rule34UserId,
    action: String,
    #[serde(default)]
    post_id: Option<PostId>,
    #[serde(default)]
    ids: Vec<PostId>,
    #[serde(default)]
    observed: Vec<PostId>,
    #[serde(default)]
    removed: Vec<PostId>,
    #[serde(default)]
    deleted: Vec<PostId>,
    #[serde(default)]
    reported_count: i64,
    #[serde(default)]
    revision: i64,
    #[serde(default)]
    count: i64,
    #[serde(default)]
    position: i64,
    #[serde(default)]
    value: String,
    #[serde(default)]
    kind: String,
}

pub async fn command(
    State(AppState { database, .. }): State<AppState>,
    Json(command): Json<Command>,
) -> AppResult<Json<Value>> {
    Ok(Json(execute(&database, &command).await?))
}

async fn execute(database: &Database, command: &Command) -> Result<Value> {
    ensure!(command.user_id.0 > 0, "invalid account");
    let mut transaction = database.pool.begin_with("BEGIN IMMEDIATE").await?;

    if command.action == "configure" {
        configure(&mut transaction, command.user_id).await?;
    }
    if command.action == "status" && !account_is_configured(&mut transaction).await? {
        transaction.commit().await?;
        return Ok(json!({"configured": false}));
    }
    verify_account(&mut transaction, command.user_id).await?;

    let result = match command.action.as_str() {
        "configure" => ok(),
        "status" => status(&mut transaction).await?,
        "library" => library(&mut transaction, command).await?,
        "memberships" => memberships(&mut transaction, command).await?,
        "membership" => set_membership(&mut transaction, command).await?,
        "budget" => set_budget(&mut transaction, command).await?,
        "pause" => set_pause(&mut transaction, command).await?,
        "retry" => retry_downloads(&mut transaction).await?,
        "claim-incremental" => claim_incremental(&mut transaction).await?,
        "baseline" => baseline(&mut transaction).await?,
        "full-scan" => finish_full_scan(&mut transaction, command).await?,
        "incremental" => finish_incremental(&mut transaction, command).await?,
        "next-download" => next_download(&mut transaction).await?,
        "download-failed" => download_failed(&mut transaction, command).await?,
        "availability" => set_availability(&mut transaction, command).await?,
        _ => bail!("unknown sync command"),
    };

    transaction.commit().await?;
    Ok(result)
}

async fn configure(connection: &mut SqliteConnection, user_id: Rule34UserId) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO sync_account (singleton, rule34_user_id)
        VALUES (1, ?)
        ON CONFLICT DO NOTHING"#,
    )
    .bind(user_id)
    .execute(connection)
    .await?;
    Ok(())
}

async fn verify_account(connection: &mut SqliteConnection, user_id: Rule34UserId) -> Result<()> {
    let configured: Option<Rule34UserId> =
        sqlx::query_scalar("SELECT rule34_user_id FROM sync_account")
            .fetch_optional(connection)
            .await?;
    ensure!(
        configured == Some(user_id),
        "configure the matching rule34 account first"
    );
    Ok(())
}

async fn account_is_configured(connection: &mut SqliteConnection) -> Result<bool> {
    Ok(
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM sync_account)")
            .fetch_one(connection)
            .await?,
    )
}

async fn status(connection: &mut SqliteConnection) -> Result<Value> {
    let account = sqlx::query("SELECT * FROM sync_account")
        .fetch_one(&mut *connection)
        .await?;
    let counts = sqlx::query(
        r#"SELECT
          (SELECT COUNT(*) FROM favorites f JOIN posts p USING (post_id)
            WHERE f.membership = 'favorited' AND p.availability != 'deleted') AS active,
          (SELECT COUNT(*) FROM post_media) AS downloaded,
          (SELECT COUNT(*) FROM favorites WHERE membership = 'unfavorited') AS archived,
          (SELECT COUNT(*) FROM posts WHERE availability = 'deleted') AS deleted,
          (SELECT COUNT(*) FROM download_queue q
             JOIN favorites f USING (post_id)
            WHERE f.membership = 'favorited' AND q.attempt_count < 5) AS pending,
          (SELECT COUNT(*) FROM favorite_order) AS baseline_count"#,
    )
    .fetch_one(&mut *connection)
    .await?;

    Ok(json!({
        "configured": true,
        "active": counts.get::<i64, _>("active"),
        "downloaded": counts.get::<i64, _>("downloaded"),
        "archived": counts.get::<i64, _>("archived"),
        "deleted": counts.get::<i64, _>("deleted"),
        "pending": counts.get::<i64, _>("pending"),
        "baselineCount": counts.get::<i64, _>("baseline_count"),
        "baselineReady": account.get::<bool, _>("baseline_ready"),
        "countOffset": account.get::<i64, _>("count_offset"),
        "budget": account.get::<i64, _>("request_budget"),
        "incrementalPaused": account.get::<bool, _>("incremental_paused"),
        "downloadsPaused": account.get::<bool, _>("downloads_paused"),
        "lastIncrementalAt": account.get::<Option<i64>, _>("last_incremental_at"),
        "lastFullScanAt": account.get::<Option<i64>, _>("last_full_scan_at"),
        "lastResult": account.get::<Option<String>, _>("last_result"),
    }))
}

async fn baseline(connection: &mut SqliteConnection) -> Result<Value> {
    let ids: Vec<PostId> =
        sqlx::query_scalar("SELECT post_id FROM favorite_order ORDER BY position")
            .fetch_all(&mut *connection)
            .await?;
    let known_ids: Vec<PostId> =
        sqlx::query_scalar("SELECT post_id FROM favorites WHERE membership != 'unfavorited'")
            .fetch_all(&mut *connection)
            .await?;
    let account = sqlx::query(
        "SELECT count_offset, request_budget, membership_revision, baseline_ready FROM sync_account",
    )
            .fetch_one(&mut *connection)
            .await?;
    Ok(json!({
        "ids": ids,
        "knownIds": known_ids,
        "countOffset": account.get::<i64, _>("count_offset"),
        "budget": account.get::<i64, _>("request_budget"),
        "revision": account.get::<i64, _>("membership_revision"),
        "ready": account.get::<bool, _>("baseline_ready"),
    }))
}

async fn claim_incremental(connection: &mut SqliteConnection) -> Result<Value> {
    let claimed = sqlx::query(
        r#"UPDATE sync_account
        SET next_incremental_at = unixepoch() + ?
        WHERE incremental_paused = 0
          AND next_incremental_at <= unixepoch()
          AND baseline_ready = 1
        RETURNING next_incremental_at"#,
    )
    .bind(INCREMENTAL_INTERVAL_SECONDS)
    .fetch_optional(connection)
    .await?
    .is_some();
    Ok(json!({"run": claimed}))
}

async fn finish_full_scan(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    validate_order(&command.ids)?;
    ensure!(command.reported_count >= 0, "invalid reported count");
    let revision: i64 = sqlx::query_scalar("SELECT membership_revision FROM sync_account")
        .fetch_one(&mut *connection)
        .await?;
    ensure!(
        revision == command.revision,
        "membership changed during full scan"
    );

    let prior: Vec<PostId> =
        sqlx::query_scalar("SELECT post_id FROM favorites WHERE membership != 'unfavorited'")
            .fetch_all(&mut *connection)
            .await?;
    let current = command.ids.iter().copied().collect::<HashSet<_>>();
    let deleted = command.deleted.iter().copied().collect::<HashSet<_>>();

    for post_id in &command.ids {
        update_membership(connection, *post_id, "favorited").await?;
    }
    for post_id in prior
        .into_iter()
        .filter(|post_id| !current.contains(post_id))
    {
        let membership = if deleted.contains(&post_id) {
            "favorited"
        } else {
            "unfavorited"
        };
        update_membership(connection, post_id, membership).await?;
        if deleted.contains(&post_id) {
            set_post_availability(connection, post_id, "deleted").await?;
        }
    }

    replace_order(connection, &command.ids).await?;
    let offset = command.reported_count - command.ids.len() as i64;
    sqlx::query(
        r#"UPDATE sync_account
        SET count_offset = ?,
            baseline_ready = 1,
            membership_revision = membership_revision + 1,
            last_full_scan_at = unixepoch(),
            last_result = 'Full scan completed',
            next_incremental_at = unixepoch() + ?"#,
    )
    .bind(offset)
    .bind(INCREMENTAL_INTERVAL_SECONDS)
    .execute(connection)
    .await?;
    Ok(json!({"countOffset": offset}))
}

async fn finish_incremental(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let current_revision: i64 = sqlx::query_scalar("SELECT membership_revision FROM sync_account")
        .fetch_one(&mut *connection)
        .await?;
    ensure!(
        current_revision == command.revision,
        "membership changed during incremental check"
    );

    for post_id in &command.observed {
        update_membership(connection, *post_id, "favorited").await?;
    }
    for post_id in &command.removed {
        update_membership(connection, *post_id, "unfavorited").await?;
    }
    for post_id in &command.deleted {
        set_post_availability(connection, *post_id, "deleted").await?;
    }

    if command.value == "reconciled" {
        validate_order(&command.ids)?;
        let offset: i64 = sqlx::query_scalar("SELECT count_offset FROM sync_account")
            .fetch_one(&mut *connection)
            .await?;
        ensure!(
            command.reported_count - offset == command.ids.len() as i64,
            "corrected count does not match the reconciled order"
        );
        replace_order(connection, &command.ids).await?;
    }

    let message = if command.value == "reconciled" {
        "No discrepancy detected"
    } else {
        command.value.as_str()
    };
    sqlx::query(
        r#"UPDATE sync_account
        SET membership_revision = membership_revision + 1,
            last_incremental_at = unixepoch(),
            last_result = ?"#,
    )
    .bind(message)
    .execute(connection)
    .await?;
    Ok(ok())
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
        sqlx::query("UPDATE favorites SET last_known_position = ? WHERE post_id = ?")
            .bind(position as i64)
            .bind(post_id)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

fn validate_order(ids: &[PostId]) -> Result<()> {
    ensure!(ids.iter().all(|id| id.0 > 0), "invalid post id");
    ensure!(
        ids.iter().copied().collect::<HashSet<_>>().len() == ids.len(),
        "favorite order contains duplicates"
    );
    Ok(())
}

async fn set_membership(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let post_id = command
        .post_id
        .ok_or_else(|| anyhow::anyhow!("missing post"))?;
    update_membership(connection, post_id, &command.value).await?;
    sqlx::query(
        "UPDATE sync_account SET membership_revision = membership_revision + 1, next_incremental_at = 0",
    )
    .execute(connection)
    .await?;
    Ok(ok())
}

async fn update_membership(
    connection: &mut SqliteConnection,
    post_id: PostId,
    membership: &str,
) -> Result<()> {
    ensure!(
        matches!(membership, "favorited" | "unfavorited"),
        "invalid membership"
    );
    let was_favorited: bool =
        sqlx::query_scalar("SELECT membership = 'favorited' FROM favorites WHERE post_id = ?")
            .bind(post_id)
            .fetch_optional(&mut *connection)
            .await?
            .unwrap_or(false);

    sqlx::query("INSERT INTO posts (post_id) VALUES (?) ON CONFLICT DO NOTHING")
        .bind(post_id)
        .execute(&mut *connection)
        .await?;
    sqlx::query(
        r#"INSERT INTO favorites (post_id, membership, membership_checked_at)
        VALUES (?, ?, unixepoch())
        ON CONFLICT (post_id) DO UPDATE SET
          membership = excluded.membership,
          membership_checked_at = excluded.membership_checked_at"#,
    )
    .bind(post_id)
    .bind(membership)
    .execute(&mut *connection)
    .await?;

    if membership == "favorited" {
        sqlx::query(
            "UPDATE posts SET availability = 'unknown' WHERE post_id = ? AND availability = 'deleted'",
        )
        .bind(post_id)
        .execute(&mut *connection)
        .await?;
        sqlx::query(
            r#"INSERT INTO download_queue (post_id)
            SELECT ? WHERE NOT EXISTS (SELECT 1 FROM post_media WHERE post_id = ?)
            ON CONFLICT DO NOTHING"#,
        )
        .bind(post_id)
        .bind(post_id)
        .execute(&mut *connection)
        .await?;
        if !was_favorited {
            sqlx::query(
                r#"UPDATE download_queue
                SET attempt_count = 0, next_attempt_at = 0,
                    last_error = NULL, claimed_until = 0
                WHERE post_id = ?"#,
            )
            .bind(post_id)
            .execute(connection)
            .await?;
        }
    }
    Ok(())
}

async fn next_download(connection: &mut SqliteConnection) -> Result<Value> {
    let paused: bool = sqlx::query_scalar("SELECT downloads_paused FROM sync_account")
        .fetch_one(&mut *connection)
        .await?;
    if paused {
        return Ok(json!({"postId": null}));
    }
    let post_id: Option<PostId> = sqlx::query_scalar(
        r#"UPDATE download_queue
        SET claimed_until = unixepoch() + ?
        WHERE post_id = (
          SELECT q.post_id FROM download_queue q
          JOIN favorites f USING (post_id)
          JOIN posts p USING (post_id)
          LEFT JOIN post_media m USING (post_id)
          WHERE f.membership = 'favorited'
            AND p.availability != 'deleted'
            AND m.post_id IS NULL
            AND q.attempt_count < 5
            AND q.next_attempt_at <= unixepoch()
            AND q.claimed_until <= unixepoch()
          ORDER BY q.next_attempt_at, q.post_id DESC
          LIMIT 1
        )
        RETURNING post_id"#,
    )
    .bind(DOWNLOAD_CLAIM_SECONDS)
    .fetch_optional(connection)
    .await?;
    Ok(json!({"postId": post_id}))
}

async fn download_failed(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let post_id = command
        .post_id
        .ok_or_else(|| anyhow::anyhow!("missing post"))?;
    sqlx::query(
        r#"UPDATE download_queue
        SET attempt_count = attempt_count + 1,
            next_attempt_at = unixepoch() + MIN(86400, 60 * (1 << attempt_count)),
            last_error = ?, claimed_until = 0
        WHERE post_id = ?"#,
    )
    .bind(&command.value)
    .bind(post_id)
    .execute(connection)
    .await?;
    Ok(ok())
}

async fn set_availability(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let post_id = command
        .post_id
        .ok_or_else(|| anyhow::anyhow!("missing post"))?;
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
    .execute(&mut *connection)
    .await?;
    if availability == "deleted" {
        sqlx::query("DELETE FROM download_queue WHERE post_id = ?")
            .bind(post_id)
            .execute(connection)
            .await?;
    }
    Ok(())
}

async fn download_failed_reset(connection: &mut SqliteConnection) -> Result<()> {
    sqlx::query(
        "UPDATE download_queue SET attempt_count = 0, next_attempt_at = 0, last_error = NULL, claimed_until = 0",
    )
    .execute(connection)
    .await?;
    Ok(())
}

async fn retry_downloads(connection: &mut SqliteConnection) -> Result<Value> {
    download_failed_reset(connection).await?;
    Ok(ok())
}

async fn set_budget(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
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

async fn set_pause(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let paused = command.value == "true";
    match command.kind.as_str() {
        "downloads" => {
            sqlx::query("UPDATE sync_account SET downloads_paused = ?")
                .bind(paused)
                .execute(connection)
                .await?;
        }
        "incremental" => {
            sqlx::query("UPDATE sync_account SET incremental_paused = ?, next_incremental_at = 0")
                .bind(paused)
                .execute(connection)
                .await?;
        }
        _ => bail!("invalid pause kind"),
    }
    Ok(ok())
}

async fn library(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    ensure!(
        matches!(command.value.as_str(), "active" | "archived" | "all"),
        "invalid filter"
    );
    let rows = sqlx::query(
        r#"SELECT p.post_id, p.availability, f.membership,
                  m.post_id IS NOT NULL AS downloaded
        FROM posts p
        JOIN favorites f USING (post_id)
        LEFT JOIN post_media m USING (post_id)
        WHERE ? = 'all'
           OR (? = 'archived' AND f.membership = 'unfavorited')
           OR (? = 'active' AND (f.membership = 'favorited' OR p.availability = 'deleted'))
        ORDER BY f.last_known_position IS NULL, f.last_known_position, p.post_id DESC
        LIMIT 50 OFFSET ?"#,
    )
    .bind(&command.value)
    .bind(&command.value)
    .bind(&command.value)
    .bind(command.position.max(0))
    .fetch_all(connection)
    .await?;
    let posts = rows
        .into_iter()
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

async fn memberships(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let mut posts = Vec::new();
    for post_id in &command.ids {
        let row = sqlx::query(
            r#"SELECT f.membership, p.availability, m.post_id IS NOT NULL AS downloaded,
                      q.attempt_count, q.last_error, q.claimed_until > unixepoch() AS downloading
            FROM favorites f JOIN posts p USING (post_id)
            LEFT JOIN post_media m USING (post_id)
            LEFT JOIN download_queue q USING (post_id)
            WHERE f.post_id = ?"#,
        )
        .bind(post_id)
        .fetch_optional(&mut *connection)
        .await?;
        let Some(row) = row else { continue };
        let downloaded = row.get::<bool, _>("downloaded");
        let membership = row.get::<String, _>("membership");
        let availability = row.get::<String, _>("availability");
        let attempts = row
            .get::<Option<i64>, _>("attempt_count")
            .unwrap_or_default();
        let state = if downloaded {
            "downloaded"
        } else if availability == "deleted" {
            "unavailable"
        } else if membership != "favorited" {
            "not queued"
        } else if row.get::<bool, _>("downloading") {
            "downloading"
        } else if attempts >= 5 {
            "failed"
        } else {
            "queued"
        };
        posts.push(json!({
            "postId": post_id, "membership": membership, "availability": availability,
            "downloaded": downloaded, "downloadState": state,
            "error": row.get::<Option<String>, _>("last_error"),
        }));
    }
    Ok(json!({"posts": posts}))
}

fn ok() -> Value {
    json!({"ok": true})
}

#[cfg(test)]
mod tests {
    use camino::Utf8Path;

    use super::{Command, execute, validate_order};
    use crate::{
        database::Database,
        ids::{PostId, Rule34UserId},
    };

    #[test]
    fn order_rejects_duplicates() {
        assert!(validate_order(&[PostId(1), PostId(1)]).is_err());
    }

    #[tokio::test]
    async fn full_scan_stores_count_offset_and_claims_once() {
        let directory = tempfile::tempdir().unwrap();
        let path = Utf8Path::from_path(directory.path())
            .unwrap()
            .join("test.db");
        let database = Database::new(&path).await.unwrap();

        execute(&database, &command("configure")).await.unwrap();
        let mut full = command("full-scan");
        full.ids = vec![PostId(30), PostId(20), PostId(10)];
        full.reported_count = 5;
        execute(&database, &full).await.unwrap();

        let baseline = execute(&database, &command("baseline")).await.unwrap();
        assert_eq!(baseline["countOffset"], 2);
        assert_eq!(baseline["ids"], serde_json::json!([30, 20, 10]));

        sqlx::query("UPDATE sync_account SET next_incremental_at = 0")
            .execute(&database.pool)
            .await
            .unwrap();
        assert_eq!(
            execute(&database, &command("claim-incremental"))
                .await
                .unwrap()["run"],
            true
        );
        assert_eq!(
            execute(&database, &command("claim-incremental"))
                .await
                .unwrap()["run"],
            false
        );
    }

    fn command(action: &str) -> Command {
        Command {
            user_id: Rule34UserId(42),
            action: action.to_string(),
            post_id: None,
            ids: Vec::new(),
            observed: Vec::new(),
            removed: Vec::new(),
            deleted: Vec::new(),
            reported_count: 0,
            revision: 0,
            count: 0,
            position: 0,
            value: String::new(),
            kind: String::new(),
        }
    }
}
