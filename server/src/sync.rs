//! Persistent coordination only: all upstream requests are made by userscripts.
use crate::{
    database::Database,
    ids::{PostId, Rule34UserId, SyncRunId},
    server::{AppResult, AppState},
};
use anyhow::{Result, ensure};
use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, SqliteConnection};

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
    #[serde(default)]
    progress: bool,
}

async fn membership(c: &mut SqliteConnection, post_id: PostId, value: &str) -> Result<()> {
    ensure!(
        post_id.0 > 0 && matches!(value, "favorited" | "unfavorited"),
        "invalid membership"
    );
    let previous: Option<String> =
        sqlx::query_scalar("SELECT membership FROM favorites WHERE post_id=?")
            .bind(post_id)
            .fetch_optional(&mut *c)
            .await?;
    sqlx::query("INSERT INTO posts(post_id) VALUES(?) ON CONFLICT DO NOTHING")
        .bind(post_id)
        .execute(&mut *c)
        .await?;
    sqlx::query(
        "INSERT INTO favorites(post_id,membership,membership_checked_at) \
         VALUES(?,?,unixepoch()) \
         ON CONFLICT(post_id) DO UPDATE SET \
         membership=excluded.membership,membership_checked_at=excluded.membership_checked_at",
    )
    .bind(post_id)
    .bind(value)
    .execute(&mut *c)
    .await?;
    if value == "favorited" {
        sqlx::query(
            "UPDATE posts SET availability='unknown' WHERE post_id=? AND availability='deleted'",
        )
        .bind(post_id)
        .execute(&mut *c)
        .await?;
        sqlx::query(
            "INSERT INTO download_queue(post_id) \
             SELECT ? WHERE NOT EXISTS(SELECT 1 FROM post_media WHERE post_id=?) \
             ON CONFLICT DO NOTHING",
        )
        .bind(post_id)
        .bind(post_id)
        .execute(&mut *c)
        .await?;
        if previous.as_deref() != Some("favorited") {
            sqlx::query(
                "UPDATE download_queue \
                 SET attempt_count=0,next_attempt_at=0,last_error=NULL WHERE post_id=?",
            )
            .bind(post_id)
            .execute(&mut *c)
            .await?;
        }
    }
    Ok(())
}

pub async fn command(
    State(AppState { database, .. }): State<AppState>,
    Json(cmd): Json<Command>,
) -> AppResult<Json<Value>> {
    Ok(Json(execute(&database, cmd).await?))
}

async fn execute(database: &Database, cmd: Command) -> Result<Value> {
    let mut t = database.pool.begin_with("BEGIN IMMEDIATE").await?;
    ensure!(cmd.user_id.0 > 0, "invalid account");
    if cmd.action == "configure" {
        sqlx::query(
            "INSERT INTO sync_account(singleton,rule34_user_id) VALUES(1,?) ON CONFLICT DO NOTHING",
        )
        .bind(cmd.user_id)
        .execute(&mut *t)
        .await?;
    }
    let account: Option<i64> = sqlx::query_scalar("SELECT rule34_user_id FROM sync_account")
        .fetch_optional(&mut *t)
        .await?;
    ensure!(
        account == Some(cmd.user_id.0),
        "configure the matching rule34 account first"
    );
    let worker_action = matches!(
        cmd.action.as_str(),
        "pace"
            | "next"
            | "failed"
            | "availability"
            | "start"
            | "page"
            | "finish"
            | "baseline"
            | "incremental"
            | "classified"
            | "run-error"
            | "boundary"
    );
    if worker_action {
        let valid: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM worker_leases \
             WHERE worker_kind=? AND owner_token=? AND generation=? \
             AND expires_at>unixepoch())",
        )
        .bind(&cmd.worker)
        .bind(&cmd.owner)
        .bind(cmd.generation)
        .fetch_one(&mut *t)
        .await?;
        ensure!(valid, "worker lease expired");
        if matches!(cmd.action.as_str(), "next" | "failed") {
            ensure!(cmd.worker == "download", "wrong worker lane");
        } else if !matches!(cmd.action.as_str(), "pace" | "availability") {
            ensure!(cmd.worker == "reconciliation", "wrong worker lane");
        }
        let paused: bool = sqlx::query_scalar(
            "SELECT CASE WHEN ?='download' THEN downloads_paused \
             ELSE reconciliation_paused END FROM sync_account",
        )
        .bind(&cmd.worker)
        .fetch_one(&mut *t)
        .await?;
        ensure!(!paused, "worker paused");
    }
    let result = match cmd.action.as_str() {
        "configure" => json!({"ok":true}),
        "library" => {
            ensure!(
                matches!(cmd.value.as_str(), "active" | "archived" | "all"),
                "invalid library filter"
            );
            let rows = sqlx::query(
                "SELECT p.post_id,p.availability,f.membership, \
                 m.post_id IS NOT NULL downloaded \
                 FROM posts p JOIN favorites f USING(post_id) \
                 LEFT JOIN post_media m USING(post_id) \
                 WHERE (?='all' OR (?='archived' AND f.membership='unfavorited') \
                 OR (?='active' AND f.membership!='unfavorited' \
                 AND (f.membership='favorited' OR p.availability='deleted'))) \
                 ORDER BY f.last_known_position IS NULL,f.last_known_position,p.post_id DESC \
                 LIMIT 50 OFFSET ?",
            )
            .bind(&cmd.value)
            .bind(&cmd.value)
            .bind(&cmd.value)
            .bind(cmd.position.max(0))
            .fetch_all(&mut *t)
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
            json!({"posts": posts})
        }
        "memberships" => {
            let mut posts = Vec::new();
            for id in &cmd.ids {
                let row = sqlx::query(
                    "SELECT f.membership,p.availability,m.post_id IS NOT NULL downloaded, \
                     q.attempt_count,q.last_error, \
                     EXISTS(SELECT 1 FROM worker_leases WHERE worker_kind='download' \
                     AND current_post_id=f.post_id AND expires_at>unixepoch()) downloading \
                     FROM favorites f JOIN posts p USING(post_id) \
                     LEFT JOIN post_media m USING(post_id) \
                     LEFT JOIN download_queue q USING(post_id) WHERE f.post_id=?",
                )
                .bind(id)
                .fetch_optional(&mut *t)
                .await?;
                if let Some(row) = row {
                    let downloaded = row.get::<bool, _>("downloaded");
                    let availability = row.get::<String, _>("availability");
                    let membership = row.get::<String, _>("membership");
                    let downloading = row.get::<bool, _>("downloading");
                    let attempt_count = row.get::<Option<i64>, _>("attempt_count").unwrap_or(0);
                    let download_state = match () {
                        _ if downloaded => "downloaded",
                        _ if availability == "deleted" => "unavailable",
                        _ if membership != "favorited" => "not queued",
                        _ if downloading => "downloading",
                        _ if attempt_count >= 5 => "failed",
                        _ => "queued",
                    };
                    posts.push(json!({
                        "postId": id,
                        "membership": membership,
                        "availability": availability,
                        "downloaded": downloaded,
                        "error": row.get::<Option<String>, _>("last_error"),
                        "downloadState": download_state,
                    }));
                }
            }
            json!({"posts":posts})
        }
        "status" => {
            let a = sqlx::query("SELECT * FROM sync_account")
                .fetch_one(&mut *t)
                .await?;
            let counts = sqlx::query(
                "SELECT \
                 (SELECT COUNT(*) FROM favorites f JOIN posts p USING(post_id) \
                    WHERE membership='favorited' AND availability!='deleted') active, \
                 (SELECT COUNT(*) FROM post_media) downloaded, \
                 (SELECT COUNT(*) FROM favorites WHERE membership='unfavorited') archived, \
                 (SELECT COUNT(*) FROM posts WHERE availability='deleted') deleted, \
                 (SELECT COUNT(*) FROM download_queue q JOIN favorites f USING(post_id) \
                    JOIN posts p USING(post_id) WHERE membership='favorited' \
                    AND availability!='deleted' AND attempt_count<5) pending",
            )
            .fetch_one(&mut *t)
            .await?;
            let run = sqlx::query("SELECT * FROM sync_runs ORDER BY sync_run_id DESC LIMIT 1")
                .fetch_optional(&mut *t)
                .await?;
            json!({
                "reconciliationPaused": a.get::<bool, _>("reconciliation_paused"),
                "downloadsPaused": a.get::<bool, _>("downloads_paused"),
                "budget": a.get::<i64, _>("request_budget"),
                "baseline": a.get::<Option<i64>, _>("baseline_run_id"),
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
            })
        }
        "membership" => {
            membership(
                &mut t,
                cmd.post_id.ok_or_else(|| anyhow::anyhow!("missing post"))?,
                &cmd.value,
            )
            .await?;
            sqlx::query(
                "UPDATE sync_account SET membership_revision=membership_revision+1,next_check_at=0",
            )
            .execute(&mut *t)
            .await?;
            json!({"ok":true})
        }
        "budget" => {
            ensure!(
                (1..=1000).contains(&cmd.count),
                "request budget must be between 1 and 1000"
            );
            sqlx::query("UPDATE sync_account SET request_budget=?")
                .bind(cmd.count)
                .execute(&mut *t)
                .await?;
            json!({"ok":true})
        }
        "pause" => {
            ensure!(
                matches!(cmd.worker.as_str(), "download" | "reconciliation"),
                "invalid worker"
            );
            let sql = if cmd.worker == "download" {
                "UPDATE sync_account SET downloads_paused=?"
            } else {
                "UPDATE sync_account SET reconciliation_paused=?"
            };
            sqlx::query(sql)
                .bind(cmd.value == "true")
                .execute(&mut *t)
                .await?;
            json!({"ok":true})
        }
        "retry" => {
            sqlx::query(
                "UPDATE download_queue SET attempt_count=0,next_attempt_at=0,last_error=NULL",
            )
            .execute(&mut *t)
            .await?;
            json!({"ok":true})
        }
        "full" => {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM sync_runs \
                 WHERE kind='full' AND status IN ('pending','running'))",
            )
            .fetch_one(&mut *t)
            .await?;
            if !exists {
                sqlx::query(
                    "INSERT INTO sync_runs(kind,revision) \
                     SELECT 'full',membership_revision FROM sync_account",
                )
                .execute(&mut *t)
                .await?;
            }
            json!({"ok":true})
        }
        "cancel" => {
            sqlx::query(
                "UPDATE sync_runs SET status='cancelled',finished_at=unixepoch() \
                 WHERE status IN ('pending','running')",
            )
            .execute(&mut *t)
            .await?;
            json!({"ok":true})
        }
        "lease" => {
            ensure!(
                matches!(cmd.worker.as_str(), "download" | "reconciliation")
                    && !cmd.owner.is_empty(),
                "invalid worker"
            );
            let row = sqlx::query(
                "INSERT INTO worker_leases( \
                    worker_kind,owner_token,generation,expires_at,last_progress_at \
                 ) VALUES(?,?,1,unixepoch()+60,unixepoch()) \
                 ON CONFLICT(worker_kind) DO UPDATE SET \
                    owner_token=excluded.owner_token, \
                    generation=worker_leases.generation+1, \
                    expires_at=excluded.expires_at, \
                    last_progress_at=excluded.last_progress_at \
                 WHERE worker_leases.expires_at<=unixepoch() RETURNING generation",
            )
            .bind(&cmd.worker)
            .bind(&cmd.owner)
            .fetch_optional(&mut *t)
            .await?;
            json!({"generation": row.map(|row| row.get::<i64, _>("generation"))})
        }
        "renew" => {
            let changed = sqlx::query(
                "UPDATE worker_leases SET expires_at=unixepoch()+60, \
                 last_progress_at=CASE WHEN ? THEN unixepoch() ELSE last_progress_at END \
                 WHERE worker_kind=? AND owner_token=? AND generation=? \
                 AND expires_at>unixepoch() AND (? OR last_progress_at>unixepoch()-600)",
            )
            .bind(cmd.progress)
            .bind(&cmd.worker)
            .bind(&cmd.owner)
            .bind(cmd.generation)
            .bind(cmd.progress)
            .execute(&mut *t)
            .await?
            .rows_affected();
            json!({"ok": changed == 1})
        }
        "release" => {
            sqlx::query(
                "UPDATE worker_leases SET expires_at=0,current_post_id=NULL \
                 WHERE worker_kind=? AND owner_token=? AND generation=?",
            )
            .bind(&cmd.worker)
            .bind(&cmd.owner)
            .bind(cmd.generation)
            .execute(&mut *t)
            .await?;
            json!({"ok":true})
        }
        "pace" => {
            let at: i64 = sqlx::query_scalar(
                "UPDATE background_pacing \
                 SET next_request_at=MAX( \
                    next_request_at,CAST(unixepoch('subsec')*1000 AS INTEGER) \
                 )+350 RETURNING next_request_at-350",
            )
            .fetch_one(&mut *t)
            .await?;
            let now: i64 = sqlx::query_scalar("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER)")
                .fetch_one(&mut *t)
                .await?;
            json!({"wait":(at-now).max(0)})
        }
        "next" => {
            let post: Option<PostId> = sqlx::query_scalar(
                "SELECT q.post_id FROM download_queue q \
                 JOIN favorites f USING(post_id) JOIN posts p USING(post_id) \
                 LEFT JOIN post_media m USING(post_id) \
                 WHERE f.membership='favorited' AND p.availability!='deleted' \
                 AND m.post_id IS NULL AND q.attempt_count<5 \
                 AND q.next_attempt_at<=unixepoch() \
                 ORDER BY q.next_attempt_at,q.post_id DESC LIMIT 1",
            )
            .fetch_optional(&mut *t)
            .await?;
            sqlx::query("UPDATE worker_leases SET current_post_id=? WHERE worker_kind='download'")
                .bind(post)
                .execute(&mut *t)
                .await?;
            json!({"postId":post})
        }
        "failed" => {
            sqlx::query(
                "UPDATE download_queue SET attempt_count=attempt_count+1, \
                 next_attempt_at=unixepoch()+MIN(86400,60*(1 << attempt_count)), \
                 last_error=? WHERE post_id=?",
            )
            .bind(cmd.value.chars().take(1000).collect::<String>())
            .bind(cmd.post_id)
            .execute(&mut *t)
            .await?;
            json!({"ok":true})
        }
        "availability" => {
            ensure!(
                matches!(cmd.value.as_str(), "available" | "deleted"),
                "invalid availability"
            );
            sqlx::query(
                "UPDATE posts SET availability=?,details_checked_at=unixepoch() WHERE post_id=?",
            )
            .bind(&cmd.value)
            .bind(cmd.post_id)
            .execute(&mut *t)
            .await?;
            json!({"ok":true})
        }
        "start" => {
            let row = sqlx::query(
                "SELECT sync_run_id,checkpoint,phase,observed_count FROM sync_runs \
                 WHERE kind='full' AND status IN ('pending','running') \
                 AND retry_after<=unixepoch() ORDER BY sync_run_id LIMIT 1",
            )
            .fetch_optional(&mut *t)
            .await?;
            if let Some(row) = row {
                let id: i64 = row.get("sync_run_id");
                sqlx::query("UPDATE sync_runs SET status='running' WHERE sync_run_id=?")
                    .bind(id)
                    .execute(&mut *t)
                    .await?;
                json!({
                    "runId": id,
                    "position": row.get::<i64, _>("checkpoint"),
                    "phase": row.get::<String, _>("phase"),
                    "count": row.get::<Option<i64>, _>("observed_count"),
                })
            } else {
                json!({"runId":null})
            }
        }
        "boundary" => {
            let ids: Vec<PostId> = sqlx::query_scalar(
                "SELECT post_id FROM sync_order_entries \
                 WHERE sync_run_id=? AND position>=? AND position<? ORDER BY position",
            )
            .bind(cmd.run_id)
            .bind(cmd.position)
            .bind(cmd.position + cmd.ids.len() as i64)
            .fetch_all(&mut *t)
            .await?;
            ensure!(
                !ids.is_empty() && ids.iter().map(|id| id.0).eq(cmd.ids.iter().map(|id| id.0)),
                "favorites changed at resume boundary"
            );
            json!({"ok":true})
        }
        "page" => {
            let run = cmd.run_id.ok_or_else(|| anyhow::anyhow!("missing run"))?;
            let row = sqlx::query(
                "SELECT checkpoint,phase,revision,observed_count FROM sync_runs \
                 WHERE sync_run_id=? AND status='running'",
            )
            .bind(run)
            .fetch_one(&mut *t)
            .await?;
            let rev: i64 = sqlx::query_scalar("SELECT membership_revision FROM sync_account")
                .fetch_one(&mut *t)
                .await?;
            ensure!(
                rev == row.get::<i64, _>("revision"),
                "favorites changed during scan; cancel and restart"
            );
            ensure!(
                cmd.position == row.get::<i64, _>("checkpoint"),
                "unexpected page offset"
            );
            let previous_count: Option<i64> = row.get("observed_count");
            ensure!(
                previous_count.is_none_or(|n| n == cmd.count),
                "favorites count changed during scan"
            );
            ensure!(
                cmd.position >= 0
                    && cmd.count >= cmd.position
                    && cmd.ids.len() as i64 == (cmd.count - cmd.position).min(50),
                "invalid page size"
            );
            let phase: String = row.get("phase");
            ensure!(
                matches!(phase.as_str(), "scan" | "verify"),
                "scan no longer accepts pages"
            );
            if phase == "scan" {
                for (offset, id) in cmd.ids.iter().enumerate() {
                    membership(&mut t, *id, "favorited").await?;
                    sqlx::query("INSERT INTO sync_order_entries(sync_run_id,position,post_id) VALUES(?,?,?)").bind(run).bind(cmd.position+offset as i64).bind(id).execute(&mut *t).await?;
                }
            } else {
                let expected:Vec<PostId>=sqlx::query_scalar("SELECT post_id FROM sync_order_entries WHERE sync_run_id=? AND position>=? AND position<? ORDER BY position").bind(run).bind(cmd.position).bind(cmd.position+cmd.ids.len() as i64).fetch_all(&mut *t).await?;
                ensure!(
                    expected.iter().map(|p| p.0).eq(cmd.ids.iter().map(|p| p.0)),
                    "favorites changed during verification; cancel and restart"
                );
            }
            sqlx::query("INSERT INTO sync_order_ranges(sync_run_id,start_position,end_position,verified) VALUES(?,?,?,?) ON CONFLICT(sync_run_id,start_position) DO UPDATE SET verified=excluded.verified").bind(run).bind(cmd.position).bind(cmd.position+cmd.ids.len() as i64).bind(phase=="verify").execute(&mut *t).await?;
            let next = cmd.position + cmd.ids.len() as i64;
            ensure!(next <= cmd.count, "page exceeds observed count");
            sqlx::query("UPDATE sync_runs SET observed_count=COALESCE(observed_count,?) WHERE sync_run_id=?").bind(cmd.count).bind(run).execute(&mut *t).await?;
            sqlx::query("UPDATE sync_runs SET checkpoint=? WHERE sync_run_id=?")
                .bind(next)
                .bind(run)
                .execute(&mut *t)
                .await?;
            ensure!(
                (cmd.value == "end") == (next == cmd.count),
                "unexpected end of scan"
            );
            if cmd.value == "end" {
                if phase == "scan" {
                    sqlx::query("UPDATE sync_runs SET phase='verify',checkpoint=0,observed_count=? WHERE sync_run_id=?").bind(next).bind(run).execute(&mut *t).await?;
                } else {
                    let count: i64 = sqlx::query_scalar(
                        "SELECT observed_count FROM sync_runs WHERE sync_run_id=?",
                    )
                    .bind(run)
                    .fetch_one(&mut *t)
                    .await?;
                    ensure!(next == count, "favorites count changed during verification");
                    sqlx::query(
                        "UPDATE sync_runs SET phase='classify',checkpoint=0 WHERE sync_run_id=?",
                    )
                    .bind(run)
                    .execute(&mut *t)
                    .await?;
                }
            }
            json!({"ok":true})
        }
        "baseline" => {
            let id: Option<i64> = sqlx::query_scalar("SELECT baseline_run_id FROM sync_account")
                .fetch_one(&mut *t)
                .await?;
            let ids: Vec<PostId> = sqlx::query_scalar(
                "SELECT post_id FROM sync_order_entries WHERE sync_run_id=? ORDER BY position",
            )
            .bind(id)
            .fetch_all(&mut *t)
            .await?;
            let a=sqlx::query("SELECT (next_check_at<=unixepoch() AND NOT EXISTS(SELECT 1 FROM sync_runs WHERE kind='full' AND status IN ('pending','running'))) due,request_budget budget,membership_revision FROM sync_account").fetch_one(&mut *t).await?;
            json!({"ids":ids,"baseline":id,"due":a.get::<bool,_>("due"),"budget":a.get::<i64,_>("budget"),"revision":a.get::<i64,_>("membership_revision")})
        }
        "run-error" => {
            let inconsistent = cmd.value.contains("changed")
                || cmd.value.contains("parsed")
                || cmd.value.contains("Unrecognized")
                || cmd.value.contains("unresolved");
            sqlx::query("UPDATE sync_runs SET status=?,message=?,retry_after=unixepoch()+60 WHERE sync_run_id=? AND status='running'").bind(if inconsistent {"unresolved"} else {"running"}).bind(&cmd.value).bind(cmd.run_id).execute(&mut *t).await?;
            json!({"ok":true})
        }
        "classified" => {
            ensure!(
                matches!(cmd.value.as_str(), "available" | "deleted"),
                "invalid availability"
            );
            let candidate:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM favorites f JOIN sync_runs r ON r.sync_run_id=? WHERE f.post_id=? AND f.membership!='unfavorited' AND r.status='running' AND r.phase='classify' AND NOT EXISTS(SELECT 1 FROM sync_order_entries e WHERE e.sync_run_id=r.sync_run_id AND e.post_id=f.post_id))").bind(cmd.run_id).bind(cmd.post_id).fetch_one(&mut *t).await?;
            ensure!(candidate, "invalid missing-post candidate");
            sqlx::query("INSERT INTO sync_missing_checks(sync_run_id,post_id,availability) VALUES(?,?,?) ON CONFLICT(sync_run_id,post_id) DO UPDATE SET availability=excluded.availability").bind(cmd.run_id).bind(cmd.post_id).bind(cmd.value).execute(&mut *t).await?;
            json!({"ok":true})
        }
        "finish" => {
            let run = cmd.run_id.ok_or_else(|| anyhow::anyhow!("missing run"))?;
            let phase: String = sqlx::query_scalar(
                "SELECT phase FROM sync_runs WHERE sync_run_id=? AND status='running'",
            )
            .bind(run)
            .fetch_one(&mut *t)
            .await?;
            ensure!(phase == "classify", "scan has not been verified");
            let candidates:Vec<PostId>=sqlx::query_scalar("SELECT post_id FROM favorites WHERE membership!='unfavorited' AND post_id NOT IN (SELECT post_id FROM sync_order_entries WHERE sync_run_id=?) AND post_id NOT IN (SELECT post_id FROM sync_missing_checks WHERE sync_run_id=?)").bind(run).bind(run).fetch_all(&mut *t).await?;
            if cmd.value != "commit" {
                let front:Vec<PostId>=sqlx::query_scalar("SELECT post_id FROM sync_order_entries WHERE sync_run_id=? AND position<50 ORDER BY position").bind(run).fetch_all(&mut *t).await?;
                json!({"ids":candidates,"front":front})
            } else {
                let rev: i64 = sqlx::query_scalar("SELECT membership_revision FROM sync_account")
                    .fetch_one(&mut *t)
                    .await?;
                let start: i64 =
                    sqlx::query_scalar("SELECT revision FROM sync_runs WHERE sync_run_id=?")
                        .bind(run)
                        .fetch_one(&mut *t)
                        .await?;
                ensure!(rev == start, "favorites changed during classification");
                ensure!(
                    candidates.is_empty(),
                    "missing posts still require classification"
                );
                let checked = sqlx::query(
                    "SELECT post_id,availability FROM sync_missing_checks WHERE sync_run_id=?",
                )
                .bind(run)
                .fetch_all(&mut *t)
                .await?;
                for row in checked {
                    let post_id: PostId = row.get("post_id");
                    let availability: String = row.get("availability");
                    sqlx::query("UPDATE posts SET availability=?,details_checked_at=unixepoch() WHERE post_id=?").bind(&availability).bind(post_id).execute(&mut *t).await?;
                    if availability == "available" {
                        membership(&mut t, post_id, "unfavorited").await?;
                    }
                }
                sqlx::query("UPDATE favorites SET last_known_position=(SELECT position FROM sync_order_entries e WHERE e.sync_run_id=? AND e.post_id=favorites.post_id) WHERE post_id IN (SELECT post_id FROM sync_order_entries WHERE sync_run_id=?)").bind(run).bind(run).execute(&mut *t).await?;
                sqlx::query("UPDATE sync_account SET baseline_run_id=?,next_check_at=unixepoch()+check_interval").bind(run).execute(&mut *t).await?;
                sqlx::query("UPDATE sync_runs SET status='complete',finished_at=unixepoch(),message=? WHERE sync_run_id=?").bind(&cmd.value).bind(run).execute(&mut *t).await?;
                json!({"ok":true})
            }
        }
        "incremental" => {
            let revision: i64 = sqlx::query_scalar("SELECT membership_revision FROM sync_account")
                .fetch_one(&mut *t)
                .await?;
            ensure!(
                revision == cmd.revision,
                "membership changed during incremental check"
            );
            for id in &cmd.observed {
                membership(&mut t, *id, "favorited").await?;
            }
            if cmd.value == "reconciled" {
                ensure!(cmd.ids.len() as i64 == cmd.count, "count mismatch");
                for id in &cmd.removed {
                    membership(&mut t, *id, "unfavorited").await?;
                }
                let run:i64=sqlx::query_scalar("INSERT INTO sync_runs(kind,status,message,finished_at) VALUES('incremental','complete','No discrepancy detected',unixepoch()) RETURNING sync_run_id").fetch_one(&mut *t).await?;
                for (position, id) in cmd.ids.iter().enumerate() {
                    sqlx::query("INSERT INTO sync_order_entries VALUES(?,?,?)")
                        .bind(run)
                        .bind(position as i64)
                        .bind(id)
                        .execute(&mut *t)
                        .await?;
                    sqlx::query("UPDATE favorites SET last_known_position=? WHERE post_id=?")
                        .bind(position as i64)
                        .bind(id)
                        .execute(&mut *t)
                        .await?;
                }
                let observed: std::collections::HashSet<i64> =
                    cmd.observed.iter().map(|id| id.0).collect();
                let mut range_start = 0usize;
                while range_start < cmd.ids.len() {
                    let verified = observed.contains(&cmd.ids[range_start].0);
                    let mut range_end = range_start + 1;
                    while range_end < cmd.ids.len()
                        && observed.contains(&cmd.ids[range_end].0) == verified
                    {
                        range_end += 1;
                    }
                    sqlx::query("INSERT INTO sync_order_ranges VALUES(?,?,?,?)")
                        .bind(run)
                        .bind(range_start as i64)
                        .bind(range_end as i64)
                        .bind(verified)
                        .execute(&mut *t)
                        .await?;
                    range_start = range_end;
                }
                let active:i64=sqlx::query_scalar("SELECT COUNT(*) FROM favorites f JOIN posts p USING(post_id) WHERE membership='favorited' AND availability!='deleted'").fetch_one(&mut *t).await?;
                if active != cmd.count {
                    sqlx::query("UPDATE sync_runs SET status='unresolved',message='Membership count still differs; a full scan is needed' WHERE sync_run_id=?").bind(run).execute(&mut *t).await?;
                }
                sqlx::query("UPDATE sync_account SET baseline_run_id=?")
                    .bind(run)
                    .execute(&mut *t)
                    .await?;
            } else {
                sqlx::query("INSERT INTO sync_runs(kind,status,message,finished_at) VALUES('incremental','unresolved',?,unixepoch())").bind(&cmd.value).execute(&mut *t).await?;
            }
            sqlx::query("UPDATE sync_account SET next_check_at=unixepoch()+check_interval")
                .execute(&mut *t)
                .await?;
            json!({"ok":true})
        }
        _ => anyhow::bail!("unknown sync command"),
    };
    if cmd.action == "finish" || cmd.action == "incremental" {
        for table in [
            "sync_order_entries",
            "sync_order_ranges",
            "sync_missing_checks",
        ] {
            sqlx::query(&format!("DELETE FROM {table} WHERE sync_run_id IN (SELECT sync_run_id FROM sync_runs WHERE status NOT IN ('pending','running')) AND sync_run_id != COALESCE((SELECT baseline_run_id FROM sync_account),-1)"))
                .execute(&mut *t).await?;
        }
    }
    t.commit().await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use camino::Utf8Path;

    async fn database() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(Utf8Path::from_path(&dir.path().join("test.db")).unwrap())
            .await
            .unwrap();
        (dir, db)
    }
    async fn call(db: &Database, action: &str, fields: Value) -> Result<Value> {
        let mut v = json!({"userId":7,"action":action});
        v.as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        execute(db, serde_json::from_value(v)?).await
    }
    async fn setup(db: &Database) -> Value {
        call(db, "configure", json!({})).await.unwrap();
        let r = call(db, "lease", json!({"worker":"download","owner":"tab-a"}))
            .await
            .unwrap();
        json!({"worker":"download","owner":"tab-a","generation":r["generation"]})
    }
    #[tokio::test]
    async fn lease_expires_and_old_owner_cannot_write() {
        let (_dir, db) = database().await;
        let old = setup(&db).await;
        assert!(
            call(&db, "lease", json!({"worker":"download","owner":"tab-b"}))
                .await
                .unwrap()["generation"]
                .is_null()
        );
        sqlx::query("UPDATE worker_leases SET expires_at=0")
            .execute(&db.pool)
            .await
            .unwrap();
        let new = call(&db, "lease", json!({"worker":"download","owner":"tab-b"}))
            .await
            .unwrap();
        assert_eq!(new["generation"], 2);
        assert!(call(&db, "next", old).await.is_err());
    }
    #[tokio::test]
    async fn unfavorite_retains_media_and_removes_queue_eligibility() {
        let (_dir, db) = database().await;
        let lease = setup(&db).await;
        call(&db, "membership", json!({"postId":123,"value":"favorited"}))
            .await
            .unwrap();
        assert_eq!(
            call(&db, "next", lease.clone()).await.unwrap()["postId"],
            123
        );
        sqlx::query("INSERT INTO post_media(post_id,storage_name,extension,mime,original) VALUES(123,'123.jpg','jpg','image/jpeg',1)").execute(&db.pool).await.unwrap();
        call(
            &db,
            "membership",
            json!({"postId":123,"value":"unfavorited"}),
        )
        .await
        .unwrap();
        assert!(call(&db, "next", lease).await.unwrap()["postId"].is_null());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_media")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }
    #[tokio::test]
    async fn account_mismatch_cannot_mutate_membership() {
        let (_dir, db) = database().await;
        setup(&db).await;
        assert!(
            call(
                &db,
                "membership",
                json!({"userId":8,"postId":1,"value":"favorited"})
            )
            .await
            .is_err()
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM posts")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
    #[tokio::test]
    async fn failed_download_yields_to_next_post() {
        let (_dir, db) = database().await;
        let lease = setup(&db).await;
        for post_id in [1, 2] {
            call(
                &db,
                "membership",
                json!({"postId":post_id,"value":"favorited"}),
            )
            .await
            .unwrap();
        }
        let mut failure = lease.clone();
        failure["postId"] = json!(2);
        failure["value"] = json!("timeout");
        call(&db, "failed", failure).await.unwrap();
        assert_eq!(call(&db, "next", lease).await.unwrap()["postId"], 1);
    }
    #[tokio::test]
    async fn scan_does_not_finalize_on_changed_order() {
        let (_dir, db) = database().await;
        setup(&db).await;
        let lease = call(
            &db,
            "lease",
            json!({"worker":"reconciliation","owner":"tab-a"}),
        )
        .await
        .unwrap();
        call(&db, "full", json!({})).await.unwrap();
        let context =
            json!({"worker":"reconciliation","owner":"tab-a","generation":lease["generation"]});
        let run = call(&db, "start", context.clone()).await.unwrap();
        let mut page = context.clone();
        page["runId"] = run["runId"].clone();
        page["ids"] = json!([1, 2]);
        page["count"] = json!(2);
        page["value"] = json!("end");
        call(&db, "page", page.clone()).await.unwrap();
        page["ids"] = json!([2, 1]);
        assert!(call(&db, "page", page).await.is_err());
        assert!(call(&db, "status", json!({})).await.unwrap()["baseline"].is_null());
    }
    #[tokio::test]
    async fn lanes_are_independent_and_pause_is_global() {
        let (_dir, db) = database().await;
        let download = setup(&db).await;
        let recon = call(
            &db,
            "lease",
            json!({"worker":"reconciliation","owner":"tab-b"}),
        )
        .await
        .unwrap();
        assert_eq!(recon["generation"], 1);
        call(&db, "pause", json!({"worker":"download","value":"true"}))
            .await
            .unwrap();
        assert!(call(&db, "next", download.clone()).await.is_err());
        call(&db, "pause", json!({"worker":"download","value":"false"}))
            .await
            .unwrap();
        assert!(call(&db, "next", download).await.is_ok());
    }
    #[tokio::test]
    async fn heartbeat_without_progress_cannot_renew_forever() {
        let (_dir, db) = database().await;
        let lease = setup(&db).await;
        sqlx::query("UPDATE worker_leases SET last_progress_at=unixepoch()-601")
            .execute(&db.pool)
            .await
            .unwrap();
        assert_eq!(call(&db, "renew", lease).await.unwrap()["ok"], false);
    }
    #[tokio::test]
    async fn full_scan_classifies_absence_and_preserves_deleted_posts() {
        let (_dir, db) = database().await;
        setup(&db).await;
        for post_id in [1, 2, 3] {
            call(
                &db,
                "membership",
                json!({"postId":post_id,"value":"favorited"}),
            )
            .await
            .unwrap();
        }
        let lease = call(
            &db,
            "lease",
            json!({"worker":"reconciliation","owner":"tab-b"}),
        )
        .await
        .unwrap();
        let context =
            json!({"worker":"reconciliation","owner":"tab-b","generation":lease["generation"]});
        call(&db, "full", json!({})).await.unwrap();
        let start = call(&db, "start", context.clone()).await.unwrap();
        let mut page = context.clone();
        page["runId"] = start["runId"].clone();
        page["ids"] = json!([1]);
        page["count"] = json!(1);
        page["value"] = json!("end");
        call(&db, "page", page.clone()).await.unwrap();
        call(&db, "page", page.clone()).await.unwrap();
        let mut classify = context.clone();
        classify["runId"] = start["runId"].clone();
        classify["postId"] = json!(2);
        classify["value"] = json!("available");
        call(&db, "classified", classify.clone()).await.unwrap();
        classify["postId"] = json!(3);
        classify["value"] = json!("deleted");
        call(&db, "classified", classify).await.unwrap();
        page["value"] = json!("commit");
        call(&db, "finish", page).await.unwrap();
        let status = call(&db, "status", json!({})).await.unwrap();
        assert_eq!(status["active"], 1);
        assert_eq!(status["archived"], 1);
        assert_eq!(status["deleted"], 1);
        let baseline = call(&db, "baseline", context).await.unwrap();
        assert_eq!(baseline["ids"], json!([1]));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM posts")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 3);
    }
    #[tokio::test]
    async fn re_favorite_reactivates_failed_download() {
        let (_dir, db) = database().await;
        let lease = setup(&db).await;
        call(&db, "membership", json!({"postId":5,"value":"favorited"}))
            .await
            .unwrap();
        sqlx::query("UPDATE download_queue SET attempt_count=5")
            .execute(&db.pool)
            .await
            .unwrap();
        assert!(call(&db, "next", lease.clone()).await.unwrap()["postId"].is_null());
        call(&db, "membership", json!({"postId":5,"value":"unfavorited"}))
            .await
            .unwrap();
        call(&db, "membership", json!({"postId":5,"value":"favorited"}))
            .await
            .unwrap();
        assert_eq!(call(&db, "next", lease).await.unwrap()["postId"], 5);
    }
}
