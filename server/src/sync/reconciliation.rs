use anyhow::{Result, anyhow, ensure};
use serde_json::{Value, json};
use sqlx::{FromRow, SqliteConnection};

use crate::ids::{PostId, SyncRunId};

use super::{Command, account::update_membership, ok};

#[derive(FromRow)]
struct ScanState {
    checkpoint: i64,
    phase: String,
    revision: i64,
    observed_count: Option<i64>,
}

#[derive(FromRow)]
struct MissingCheck {
    post_id: PostId,
    availability: String,
}

pub(super) async fn start_full_scan(connection: &mut SqliteConnection) -> Result<Value> {
    let run = sqlx::query(
        r#"SELECT sync_run_id, checkpoint, phase, observed_count
        FROM sync_runs
        WHERE kind = 'full'
          AND status IN ('pending', 'running')
          AND retry_after <= unixepoch()
        ORDER BY sync_run_id
        LIMIT 1"#,
    )
    .fetch_optional(&mut *connection)
    .await?;

    let Some(run) = run else {
        return Ok(json!({"runId": null}));
    };

    use sqlx::Row;
    let run_id: SyncRunId = run.get("sync_run_id");
    sqlx::query(
        r#"UPDATE sync_runs
        SET status = 'running'
        WHERE sync_run_id = ?"#,
    )
    .bind(run_id)
    .execute(connection)
    .await?;

    Ok(json!({
        "runId": run_id,
        "position": run.get::<i64, _>("checkpoint"),
        "phase": run.get::<String, _>("phase"),
        "count": run.get::<Option<i64>, _>("observed_count"),
    }))
}

pub(super) async fn verify_boundary(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    let ids: Vec<PostId> = sqlx::query_scalar(
        r#"SELECT post_id
        FROM sync_order_entries
        WHERE sync_run_id = ?
          AND position >= ?
          AND position < ?
        ORDER BY position"#,
    )
    .bind(command.run_id)
    .bind(command.position)
    .bind(command.position + command.ids.len() as i64)
    .fetch_all(connection)
    .await?;

    ensure!(
        !ids.is_empty() && ids == command.ids,
        "favorites changed at resume boundary"
    );
    Ok(ok())
}

pub(super) async fn record_page(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    let run_id = required_run(command)?;
    let scan = load_scan(connection, run_id).await?;
    validate_page(connection, command, &scan).await?;

    match scan.phase.as_str() {
        "scan" => store_page_entries(connection, run_id, command).await?,
        "verify" => verify_page_entries(connection, run_id, command).await?,
        _ => return Err(anyhow!("scan no longer accepts pages")),
    }

    store_page_range(connection, run_id, command, scan.phase == "verify").await?;

    let next = command.position + command.ids.len() as i64;
    ensure!(next <= command.count, "page exceeds observed count");

    sqlx::query(
        r#"UPDATE sync_runs
        SET observed_count = COALESCE(observed_count, ?),
            checkpoint = ?
        WHERE sync_run_id = ?"#,
    )
    .bind(command.count)
    .bind(next)
    .bind(run_id)
    .execute(&mut *connection)
    .await?;

    let reached_end = next == command.count;
    ensure!(
        (command.value == "end") == reached_end,
        "unexpected end of scan"
    );

    if reached_end {
        advance_scan(connection, run_id, &scan.phase, next).await?;
    }

    Ok(ok())
}

async fn load_scan(connection: &mut SqliteConnection, run_id: SyncRunId) -> Result<ScanState> {
    Ok(sqlx::query_as(
        r#"SELECT checkpoint, phase, revision, observed_count
        FROM sync_runs
        WHERE sync_run_id = ? AND status = 'running'"#,
    )
    .bind(run_id)
    .fetch_one(connection)
    .await?)
}

async fn validate_page(
    connection: &mut SqliteConnection,
    command: &Command,
    scan: &ScanState,
) -> Result<()> {
    let revision: i64 = sqlx::query_scalar("SELECT membership_revision FROM sync_account")
        .fetch_one(connection)
        .await?;

    ensure!(
        revision == scan.revision,
        "favorites changed during scan; cancel and restart"
    );
    ensure!(
        command.position == scan.checkpoint,
        "unexpected page offset"
    );
    ensure!(
        scan.observed_count
            .is_none_or(|count| count == command.count),
        "favorites count changed during scan"
    );
    ensure!(
        command.position >= 0
            && command.count >= command.position
            && command.ids.len() as i64 == (command.count - command.position).min(50),
        "invalid page size"
    );
    ensure!(
        matches!(scan.phase.as_str(), "scan" | "verify"),
        "scan no longer accepts pages"
    );

    Ok(())
}

async fn store_page_entries(
    connection: &mut SqliteConnection,
    run_id: SyncRunId,
    command: &Command,
) -> Result<()> {
    for (offset, post_id) in command.ids.iter().enumerate() {
        update_membership(connection, *post_id, "favorited").await?;

        sqlx::query(
            r#"INSERT INTO sync_order_entries (sync_run_id, position, post_id)
            VALUES (?, ?, ?)"#,
        )
        .bind(run_id)
        .bind(command.position + offset as i64)
        .bind(post_id)
        .execute(&mut *connection)
        .await?;
    }

    Ok(())
}

async fn verify_page_entries(
    connection: &mut SqliteConnection,
    run_id: SyncRunId,
    command: &Command,
) -> Result<()> {
    let expected: Vec<PostId> = sqlx::query_scalar(
        r#"SELECT post_id
        FROM sync_order_entries
        WHERE sync_run_id = ?
          AND position >= ?
          AND position < ?
        ORDER BY position"#,
    )
    .bind(run_id)
    .bind(command.position)
    .bind(command.position + command.ids.len() as i64)
    .fetch_all(connection)
    .await?;

    ensure!(
        expected == command.ids,
        "favorites changed during verification; cancel and restart"
    );
    Ok(())
}

async fn store_page_range(
    connection: &mut SqliteConnection,
    run_id: SyncRunId,
    command: &Command,
    verified: bool,
) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO sync_order_ranges (
            sync_run_id,
            start_position,
            end_position,
            verified
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT (sync_run_id, start_position) DO UPDATE SET
            verified = excluded.verified"#,
    )
    .bind(run_id)
    .bind(command.position)
    .bind(command.position + command.ids.len() as i64)
    .bind(verified)
    .execute(connection)
    .await?;

    Ok(())
}

async fn advance_scan(
    connection: &mut SqliteConnection,
    run_id: SyncRunId,
    phase: &str,
    count: i64,
) -> Result<()> {
    if phase == "scan" {
        sqlx::query(
            r#"UPDATE sync_runs
            SET phase = 'verify',
                checkpoint = 0,
                observed_count = ?
            WHERE sync_run_id = ?"#,
        )
        .bind(count)
        .bind(run_id)
        .execute(connection)
        .await?;

        return Ok(());
    }

    let observed_count: i64 =
        sqlx::query_scalar("SELECT observed_count FROM sync_runs WHERE sync_run_id = ?")
            .bind(run_id)
            .fetch_one(&mut *connection)
            .await?;
    ensure!(
        count == observed_count,
        "favorites count changed during verification"
    );

    sqlx::query(
        r#"UPDATE sync_runs
        SET phase = 'classify', checkpoint = 0
        WHERE sync_run_id = ?"#,
    )
    .bind(run_id)
    .execute(connection)
    .await?;

    Ok(())
}

pub(super) async fn baseline(connection: &mut SqliteConnection) -> Result<Value> {
    use sqlx::Row;

    let baseline_id: Option<SyncRunId> =
        sqlx::query_scalar("SELECT baseline_run_id FROM sync_account")
            .fetch_one(&mut *connection)
            .await?;
    let ids: Vec<PostId> = sqlx::query_scalar(
        r#"SELECT post_id
        FROM sync_order_entries
        WHERE sync_run_id = ?
        ORDER BY position"#,
    )
    .bind(baseline_id)
    .fetch_all(&mut *connection)
    .await?;
    let account = sqlx::query(
        r#"SELECT
            next_check_at <= unixepoch()
                AND NOT EXISTS (
                    SELECT 1
                    FROM sync_runs
                    WHERE kind = 'full'
                      AND status IN ('pending', 'running')
                ) AS due,
            request_budget AS budget,
            membership_revision AS revision
        FROM sync_account"#,
    )
    .fetch_one(connection)
    .await?;

    Ok(json!({
        "ids": ids,
        "baseline": baseline_id,
        "due": account.get::<bool, _>("due"),
        "budget": account.get::<i64, _>("budget"),
        "revision": account.get::<i64, _>("revision"),
    }))
}

pub(super) async fn record_run_error(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    let inconsistent = command.value.contains("changed")
        || command.value.contains("parsed")
        || command.value.contains("Unrecognized")
        || command.value.contains("unresolved");
    let status = if inconsistent {
        "unresolved"
    } else {
        "running"
    };

    sqlx::query(
        r#"UPDATE sync_runs
        SET status = ?,
            message = ?,
            retry_after = unixepoch() + 60
        WHERE sync_run_id = ? AND status = 'running'"#,
    )
    .bind(status)
    .bind(&command.value)
    .bind(command.run_id)
    .execute(connection)
    .await?;

    Ok(ok())
}

pub(super) async fn classify_missing(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    ensure!(
        matches!(command.value.as_str(), "available" | "deleted"),
        "invalid availability"
    );

    let candidate: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
            SELECT 1
            FROM favorites f
            JOIN sync_runs r ON r.sync_run_id = ?
            WHERE f.post_id = ?
              AND f.membership != 'unfavorited'
              AND r.status = 'running'
              AND r.phase = 'classify'
              AND NOT EXISTS (
                  SELECT 1
                  FROM sync_order_entries e
                  WHERE e.sync_run_id = r.sync_run_id
                    AND e.post_id = f.post_id
              )
        )"#,
    )
    .bind(command.run_id)
    .bind(command.post_id)
    .fetch_one(&mut *connection)
    .await?;
    ensure!(candidate, "invalid missing-post candidate");

    sqlx::query(
        r#"INSERT INTO sync_missing_checks (sync_run_id, post_id, availability)
        VALUES (?, ?, ?)
        ON CONFLICT (sync_run_id, post_id) DO UPDATE SET
            availability = excluded.availability"#,
    )
    .bind(command.run_id)
    .bind(command.post_id)
    .bind(&command.value)
    .execute(connection)
    .await?;

    Ok(ok())
}

pub(super) async fn finish_full_scan(
    connection: &mut SqliteConnection,
    command: &Command,
) -> Result<Value> {
    let run_id = required_run(command)?;
    let phase: String = sqlx::query_scalar(
        r#"SELECT phase
        FROM sync_runs
        WHERE sync_run_id = ? AND status = 'running'"#,
    )
    .bind(run_id)
    .fetch_one(&mut *connection)
    .await?;
    ensure!(phase == "classify", "scan has not been verified");

    let candidates = missing_candidates(connection, run_id).await?;
    if command.value != "commit" {
        let front: Vec<PostId> = sqlx::query_scalar(
            r#"SELECT post_id
            FROM sync_order_entries
            WHERE sync_run_id = ? AND position < 50
            ORDER BY position"#,
        )
        .bind(run_id)
        .fetch_all(connection)
        .await?;

        return Ok(json!({"ids": candidates, "front": front}));
    }

    publish_full_scan(connection, run_id, candidates, &command.value).await?;
    Ok(ok())
}

async fn missing_candidates(
    connection: &mut SqliteConnection,
    run_id: SyncRunId,
) -> Result<Vec<PostId>> {
    Ok(sqlx::query_scalar(
        r#"SELECT post_id
        FROM favorites
        WHERE membership != 'unfavorited'
          AND post_id NOT IN (
              SELECT post_id
              FROM sync_order_entries
              WHERE sync_run_id = ?
          )
          AND post_id NOT IN (
              SELECT post_id
              FROM sync_missing_checks
              WHERE sync_run_id = ?
          )"#,
    )
    .bind(run_id)
    .bind(run_id)
    .fetch_all(connection)
    .await?)
}

async fn publish_full_scan(
    connection: &mut SqliteConnection,
    run_id: SyncRunId,
    candidates: Vec<PostId>,
    message: &str,
) -> Result<()> {
    let revision: i64 = sqlx::query_scalar("SELECT membership_revision FROM sync_account")
        .fetch_one(&mut *connection)
        .await?;
    let start_revision: i64 =
        sqlx::query_scalar("SELECT revision FROM sync_runs WHERE sync_run_id = ?")
            .bind(run_id)
            .fetch_one(&mut *connection)
            .await?;

    ensure!(
        revision == start_revision,
        "favorites changed during classification"
    );
    ensure!(
        candidates.is_empty(),
        "missing posts still require classification"
    );

    let checked: Vec<MissingCheck> = sqlx::query_as(
        r#"SELECT post_id, availability
        FROM sync_missing_checks
        WHERE sync_run_id = ?"#,
    )
    .bind(run_id)
    .fetch_all(&mut *connection)
    .await?;

    for check in checked {
        sqlx::query(
            r#"UPDATE posts
            SET availability = ?,
                details_checked_at = unixepoch()
            WHERE post_id = ?"#,
        )
        .bind(&check.availability)
        .bind(check.post_id)
        .execute(&mut *connection)
        .await?;

        if check.availability == "available" {
            update_membership(connection, check.post_id, "unfavorited").await?;
        }
    }

    sqlx::query(
        r#"UPDATE favorites
        SET last_known_position = (
            SELECT position
            FROM sync_order_entries e
            WHERE e.sync_run_id = ?
              AND e.post_id = favorites.post_id
        )
        WHERE post_id IN (
            SELECT post_id
            FROM sync_order_entries
            WHERE sync_run_id = ?
        )"#,
    )
    .bind(run_id)
    .bind(run_id)
    .execute(&mut *connection)
    .await?;

    sqlx::query(
        r#"UPDATE sync_account
        SET baseline_run_id = ?,
            next_check_at = unixepoch() + check_interval"#,
    )
    .bind(run_id)
    .execute(&mut *connection)
    .await?;

    sqlx::query(
        r#"UPDATE sync_runs
        SET status = 'complete',
            finished_at = unixepoch(),
            message = ?
        WHERE sync_run_id = ?"#,
    )
    .bind(message)
    .bind(run_id)
    .execute(connection)
    .await?;

    Ok(())
}

fn required_run(command: &Command) -> Result<SyncRunId> {
    command.run_id.ok_or_else(|| anyhow!("missing run"))
}
