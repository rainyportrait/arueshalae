//! Persistent coordination only: all upstream requests are made by userscripts.

mod account;
mod history;
mod incremental;
mod reconciliation;
mod workers;

#[cfg(test)]
mod tests;

use anyhow::{Result, bail, ensure};
use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::Value;
use sqlx::SqliteConnection;

use crate::{
    database::Database,
    ids::{PostId, Rule34UserId, SyncRunId},
    server::{AppResult, AppState},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    user_id: Rule34UserId,
    action: String,

    #[serde(default)]
    owner: String,
    #[serde(default)]
    worker: String,
    #[serde(default)]
    generation: i64,
    #[serde(default)]
    progress: bool,

    #[serde(default)]
    post_id: Option<PostId>,
    #[serde(default)]
    ids: Vec<PostId>,

    #[serde(default)]
    run_id: Option<SyncRunId>,
    #[serde(default)]
    position: i64,
    #[serde(default)]
    count: i64,
    #[serde(default)]
    removed: Vec<PostId>,
    #[serde(default)]
    observed: Vec<PostId>,
    #[serde(default)]
    revision: i64,
    #[serde(default)]
    value: String,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum Action {
    Configure,
    Library,
    Memberships,
    Status,
    Membership,
    Budget,
    Pause,
    Retry,
    Full,
    Cancel,

    Lease,
    Renew,
    Release,

    Pace,
    Next,
    Failed,
    Availability,

    Start,
    Boundary,
    Page,
    Baseline,
    RunError,
    Classified,
    Finish,
    Incremental,
}

impl Action {
    fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "configure" => Self::Configure,
            "library" => Self::Library,
            "memberships" => Self::Memberships,
            "status" => Self::Status,
            "membership" => Self::Membership,
            "budget" => Self::Budget,
            "pause" => Self::Pause,
            "retry" => Self::Retry,
            "full" => Self::Full,
            "cancel" => Self::Cancel,
            "lease" => Self::Lease,
            "renew" => Self::Renew,
            "release" => Self::Release,
            "pace" => Self::Pace,
            "next" => Self::Next,
            "failed" => Self::Failed,
            "availability" => Self::Availability,
            "start" => Self::Start,
            "boundary" => Self::Boundary,
            "page" => Self::Page,
            "baseline" => Self::Baseline,
            "run-error" => Self::RunError,
            "classified" => Self::Classified,
            "finish" => Self::Finish,
            "incremental" => Self::Incremental,
            _ => bail!("unknown sync command"),
        })
    }

    fn worker_requirement(self) -> Option<WorkerRequirement> {
        match self {
            Self::Pace | Self::Availability => Some(WorkerRequirement::Either),
            Self::Next | Self::Failed => Some(WorkerRequirement::Download),
            Self::Start
            | Self::Boundary
            | Self::Page
            | Self::Baseline
            | Self::RunError
            | Self::Classified
            | Self::Finish
            | Self::Incremental => Some(WorkerRequirement::Reconciliation),
            _ => None,
        }
    }

    fn removes_old_run_data(self) -> bool {
        matches!(self, Self::Finish | Self::Incremental)
    }
}

#[derive(Clone, Copy)]
enum WorkerRequirement {
    Either,
    Download,
    Reconciliation,
}

pub async fn command(
    State(AppState { database, .. }): State<AppState>,
    Json(command): Json<Command>,
) -> AppResult<Json<Value>> {
    Ok(Json(execute(&database, command).await?))
}

async fn execute(database: &Database, command: Command) -> Result<Value> {
    let action = Action::parse(&command.action)?;
    let mut transaction = database.pool.begin_with("BEGIN IMMEDIATE").await?;

    ensure!(command.user_id.0 > 0, "invalid account");
    if action == Action::Configure {
        configure_account(&mut transaction, command.user_id).await?;
    }
    verify_account(&mut transaction, command.user_id).await?;

    if let Some(requirement) = action.worker_requirement() {
        verify_worker(&mut transaction, &command, requirement).await?;
    }

    let result = dispatch(&mut transaction, action, &command).await?;

    if action.removes_old_run_data() {
        history::remove_old_run_data(&mut transaction).await?;
    }

    transaction.commit().await?;
    Ok(result)
}

async fn configure_account(connection: &mut SqliteConnection, user_id: Rule34UserId) -> Result<()> {
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

async fn verify_worker(
    connection: &mut SqliteConnection,
    command: &Command,
    requirement: WorkerRequirement,
) -> Result<()> {
    let valid: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
            SELECT 1
            FROM worker_leases
            WHERE worker_kind = ?
              AND owner_token = ?
              AND generation = ?
              AND expires_at > unixepoch()
        )"#,
    )
    .bind(&command.worker)
    .bind(&command.owner)
    .bind(command.generation)
    .fetch_one(&mut *connection)
    .await?;
    ensure!(valid, "worker lease expired");

    match requirement {
        WorkerRequirement::Either => {}
        WorkerRequirement::Download => {
            ensure!(command.worker == "download", "wrong worker lane");
        }
        WorkerRequirement::Reconciliation => {
            ensure!(command.worker == "reconciliation", "wrong worker lane");
        }
    }

    let paused: bool = sqlx::query_scalar(
        r#"SELECT CASE
            WHEN ? = 'download' THEN downloads_paused
            ELSE reconciliation_paused
        END
        FROM sync_account"#,
    )
    .bind(&command.worker)
    .fetch_one(connection)
    .await?;
    ensure!(!paused, "worker paused");

    Ok(())
}

async fn dispatch(
    connection: &mut SqliteConnection,
    action: Action,
    command: &Command,
) -> Result<Value> {
    match action {
        Action::Configure => Ok(ok()),
        Action::Library => account::library(connection, command).await,
        Action::Memberships => account::memberships(connection, command).await,
        Action::Status => account::status(connection).await,
        Action::Membership => account::set_membership(connection, command).await,
        Action::Budget => account::set_budget(connection, command).await,
        Action::Pause => account::set_pause(connection, command).await,
        Action::Retry => account::retry_downloads(connection).await,
        Action::Full => account::queue_full_scan(connection).await,
        Action::Cancel => account::cancel_full_scan(connection).await,

        Action::Lease => workers::acquire_lease(connection, command).await,
        Action::Renew => workers::renew_lease(connection, command).await,
        Action::Release => workers::release_lease(connection, command).await,

        Action::Pace => workers::pace(connection).await,
        Action::Next => workers::next_download(connection).await,
        Action::Failed => workers::record_download_failure(connection, command).await,
        Action::Availability => workers::set_availability(connection, command).await,

        Action::Start => reconciliation::start_full_scan(connection).await,
        Action::Boundary => reconciliation::verify_boundary(connection, command).await,
        Action::Page => reconciliation::record_page(connection, command).await,
        Action::Baseline => reconciliation::baseline(connection).await,
        Action::RunError => reconciliation::record_run_error(connection, command).await,
        Action::Classified => reconciliation::classify_missing(connection, command).await,
        Action::Finish => reconciliation::finish_full_scan(connection, command).await,
        Action::Incremental => incremental::finish(connection, command).await,
    }
}

fn ok() -> Value {
    serde_json::json!({"ok": true})
}
