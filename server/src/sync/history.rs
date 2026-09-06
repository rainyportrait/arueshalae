use anyhow::Result;
use sqlx::SqliteConnection;

pub(super) async fn remove_old_run_data(connection: &mut SqliteConnection) -> Result<()> {
    let statements = [
        r#"DELETE FROM sync_order_entries
        WHERE sync_run_id IN (
            SELECT sync_run_id
            FROM sync_runs
            WHERE status NOT IN ('pending', 'running')
        )
        AND sync_run_id != COALESCE(
            (SELECT baseline_run_id FROM sync_account),
            -1
        )"#,
        r#"DELETE FROM sync_order_ranges
        WHERE sync_run_id IN (
            SELECT sync_run_id
            FROM sync_runs
            WHERE status NOT IN ('pending', 'running')
        )
        AND sync_run_id != COALESCE(
            (SELECT baseline_run_id FROM sync_account),
            -1
        )"#,
        r#"DELETE FROM sync_missing_checks
        WHERE sync_run_id IN (
            SELECT sync_run_id
            FROM sync_runs
            WHERE status NOT IN ('pending', 'running')
        )
        AND sync_run_id != COALESCE(
            (SELECT baseline_run_id FROM sync_account),
            -1
        )"#,
    ];

    for statement in statements {
        sqlx::query(statement).execute(&mut *connection).await?;
    }

    Ok(())
}
