use std::collections::HashSet;

use anyhow::{Result, ensure};
use serde_json::Value;
use sqlx::SqliteConnection;

use crate::ids::SyncRunId;

use super::{Command, account::update_membership, ok};

pub(super) async fn finish(connection: &mut SqliteConnection, command: &Command) -> Result<Value> {
    let revision: i64 = sqlx::query_scalar("SELECT membership_revision FROM sync_account")
        .fetch_one(&mut *connection)
        .await?;
    ensure!(
        revision == command.revision,
        "membership changed during incremental check"
    );

    for post_id in &command.observed {
        update_membership(connection, *post_id, "favorited").await?;
    }

    if command.value == "reconciled" {
        publish(connection, command).await?;
    } else {
        sqlx::query(
            r#"INSERT INTO sync_runs (kind, status, message, finished_at)
            VALUES ('incremental', 'unresolved', ?, unixepoch())"#,
        )
        .bind(&command.value)
        .execute(&mut *connection)
        .await?;
    }

    sqlx::query(
        r#"UPDATE sync_account
        SET next_check_at = unixepoch() + check_interval"#,
    )
    .execute(connection)
    .await?;

    Ok(ok())
}

async fn publish(connection: &mut SqliteConnection, command: &Command) -> Result<()> {
    ensure!(command.ids.len() as i64 == command.count, "count mismatch");

    for post_id in &command.removed {
        update_membership(connection, *post_id, "unfavorited").await?;
    }

    let run_id: SyncRunId = sqlx::query_scalar(
        r#"INSERT INTO sync_runs (kind, status, message, finished_at)
        VALUES (
            'incremental',
            'complete',
            'No discrepancy detected',
            unixepoch()
        )
        RETURNING sync_run_id"#,
    )
    .fetch_one(&mut *connection)
    .await?;

    for (position, post_id) in command.ids.iter().enumerate() {
        sqlx::query(
            r#"INSERT INTO sync_order_entries (sync_run_id, position, post_id)
            VALUES (?, ?, ?)"#,
        )
        .bind(run_id)
        .bind(position as i64)
        .bind(post_id)
        .execute(&mut *connection)
        .await?;

        sqlx::query(
            r#"UPDATE favorites
            SET last_known_position = ?
            WHERE post_id = ?"#,
        )
        .bind(position as i64)
        .bind(post_id)
        .execute(&mut *connection)
        .await?;
    }

    record_ranges(connection, run_id, command).await?;

    let active: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
        FROM favorites f
        JOIN posts p USING (post_id)
        WHERE membership = 'favorited'
          AND availability != 'deleted'"#,
    )
    .fetch_one(&mut *connection)
    .await?;
    if active != command.count {
        sqlx::query(
            r#"UPDATE sync_runs
            SET status = 'unresolved',
                message = 'Membership count still differs; a full scan is needed'
            WHERE sync_run_id = ?"#,
        )
        .bind(run_id)
        .execute(&mut *connection)
        .await?;
    }

    sqlx::query("UPDATE sync_account SET baseline_run_id = ?")
        .bind(run_id)
        .execute(connection)
        .await?;

    Ok(())
}

async fn record_ranges(
    connection: &mut SqliteConnection,
    run_id: SyncRunId,
    command: &Command,
) -> Result<()> {
    let observed = command.observed.iter().copied().collect::<HashSet<_>>();
    let mut range_start = 0;

    while range_start < command.ids.len() {
        let verified = observed.contains(&command.ids[range_start]);
        let mut range_end = range_start + 1;

        while range_end < command.ids.len()
            && observed.contains(&command.ids[range_end]) == verified
        {
            range_end += 1;
        }

        sqlx::query(
            r#"INSERT INTO sync_order_ranges (
                sync_run_id,
                start_position,
                end_position,
                verified
            ) VALUES (?, ?, ?, ?)"#,
        )
        .bind(run_id)
        .bind(range_start as i64)
        .bind(range_end as i64)
        .bind(verified)
        .execute(&mut *connection)
        .await?;

        range_start = range_end;
    }

    Ok(())
}
