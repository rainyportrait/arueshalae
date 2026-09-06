use anyhow::Result;
use camino::Utf8Path;
use serde_json::{Value, json};

use crate::database::Database;

use super::execute;

async fn database() -> (tempfile::TempDir, Database) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("test.db");
    let database = Database::new(Utf8Path::from_path(&path).unwrap())
        .await
        .unwrap();

    (directory, database)
}

async fn call(database: &Database, action: &str, fields: Value) -> Result<Value> {
    let mut value = json!({"userId": 7, "action": action});
    value
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());

    execute(database, serde_json::from_value(value)?).await
}

async fn setup(database: &Database) -> Value {
    call(database, "configure", json!({})).await.unwrap();
    let lease = call(
        database,
        "lease",
        json!({"worker": "download", "owner": "tab-a"}),
    )
    .await
    .unwrap();

    json!({
        "worker": "download",
        "owner": "tab-a",
        "generation": lease["generation"],
    })
}

#[tokio::test]
async fn lease_expires_and_old_owner_cannot_write() {
    let (_directory, database) = database().await;
    let old_lease = setup(&database).await;

    let occupied = call(
        &database,
        "lease",
        json!({"worker": "download", "owner": "tab-b"}),
    )
    .await
    .unwrap();
    assert!(occupied["generation"].is_null());

    sqlx::query("UPDATE worker_leases SET expires_at = 0")
        .execute(&database.pool)
        .await
        .unwrap();
    let new_lease = call(
        &database,
        "lease",
        json!({"worker": "download", "owner": "tab-b"}),
    )
    .await
    .unwrap();

    assert_eq!(new_lease["generation"], 2);
    assert!(call(&database, "next", old_lease).await.is_err());
}

#[tokio::test]
async fn unfavorite_retains_media_and_removes_queue_eligibility() {
    let (_directory, database) = database().await;
    let lease = setup(&database).await;

    call(
        &database,
        "membership",
        json!({"postId": 123, "value": "favorited"}),
    )
    .await
    .unwrap();
    assert_eq!(
        call(&database, "next", lease.clone()).await.unwrap()["postId"],
        123
    );

    sqlx::query(
        r#"INSERT INTO post_media (
            post_id,
            storage_name,
            extension,
            mime,
            original
        ) VALUES (123, '123.jpg', 'jpg', 'image/jpeg', 1)"#,
    )
    .execute(&database.pool)
    .await
    .unwrap();
    call(
        &database,
        "membership",
        json!({"postId": 123, "value": "unfavorited"}),
    )
    .await
    .unwrap();

    assert!(call(&database, "next", lease).await.unwrap()["postId"].is_null());
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_media")
        .fetch_one(&database.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn account_mismatch_cannot_mutate_membership() {
    let (_directory, database) = database().await;
    setup(&database).await;

    assert!(
        call(
            &database,
            "membership",
            json!({"userId": 8, "postId": 1, "value": "favorited"}),
        )
        .await
        .is_err()
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM posts")
        .fetch_one(&database.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn failed_download_yields_to_next_post() {
    let (_directory, database) = database().await;
    let lease = setup(&database).await;

    for post_id in [1, 2] {
        call(
            &database,
            "membership",
            json!({"postId": post_id, "value": "favorited"}),
        )
        .await
        .unwrap();
    }

    let mut failure = lease.clone();
    failure["postId"] = json!(2);
    failure["value"] = json!("timeout");
    call(&database, "failed", failure).await.unwrap();

    assert_eq!(call(&database, "next", lease).await.unwrap()["postId"], 1);
}

#[tokio::test]
async fn scan_does_not_finalize_on_changed_order() {
    let (_directory, database) = database().await;
    setup(&database).await;
    let lease = call(
        &database,
        "lease",
        json!({"worker": "reconciliation", "owner": "tab-a"}),
    )
    .await
    .unwrap();

    call(&database, "full", json!({})).await.unwrap();
    let context = json!({
        "worker": "reconciliation",
        "owner": "tab-a",
        "generation": lease["generation"],
    });
    let run = call(&database, "start", context.clone()).await.unwrap();
    let mut page = context.clone();
    page["runId"] = run["runId"].clone();
    page["ids"] = json!([1, 2]);
    page["count"] = json!(2);
    page["value"] = json!("end");

    call(&database, "page", page.clone()).await.unwrap();
    page["ids"] = json!([2, 1]);

    assert!(call(&database, "page", page).await.is_err());
    assert!(call(&database, "status", json!({})).await.unwrap()["baseline"].is_null());
}

#[tokio::test]
async fn lanes_are_independent_and_pause_is_global() {
    let (_directory, database) = database().await;
    let download = setup(&database).await;
    let reconciliation = call(
        &database,
        "lease",
        json!({"worker": "reconciliation", "owner": "tab-b"}),
    )
    .await
    .unwrap();

    assert_eq!(reconciliation["generation"], 1);

    call(
        &database,
        "pause",
        json!({"worker": "download", "value": "true"}),
    )
    .await
    .unwrap();
    assert!(call(&database, "next", download.clone()).await.is_err());

    call(
        &database,
        "pause",
        json!({"worker": "download", "value": "false"}),
    )
    .await
    .unwrap();
    assert!(call(&database, "next", download).await.is_ok());
}

#[tokio::test]
async fn heartbeat_without_progress_cannot_renew_forever() {
    let (_directory, database) = database().await;
    let lease = setup(&database).await;

    sqlx::query("UPDATE worker_leases SET last_progress_at = unixepoch() - 601")
        .execute(&database.pool)
        .await
        .unwrap();

    assert_eq!(call(&database, "renew", lease).await.unwrap()["ok"], false);
}

#[tokio::test]
async fn full_scan_classifies_absence_and_preserves_deleted_posts() {
    let (_directory, database) = database().await;
    setup(&database).await;

    for post_id in [1, 2, 3] {
        call(
            &database,
            "membership",
            json!({"postId": post_id, "value": "favorited"}),
        )
        .await
        .unwrap();
    }

    let lease = call(
        &database,
        "lease",
        json!({"worker": "reconciliation", "owner": "tab-b"}),
    )
    .await
    .unwrap();
    let context = json!({
        "worker": "reconciliation",
        "owner": "tab-b",
        "generation": lease["generation"],
    });

    call(&database, "full", json!({})).await.unwrap();
    let start = call(&database, "start", context.clone()).await.unwrap();
    let mut page = context.clone();
    page["runId"] = start["runId"].clone();
    page["ids"] = json!([1]);
    page["count"] = json!(1);
    page["value"] = json!("end");

    call(&database, "page", page.clone()).await.unwrap();
    call(&database, "page", page.clone()).await.unwrap();

    let mut classify = context.clone();
    classify["runId"] = start["runId"].clone();
    classify["postId"] = json!(2);
    classify["value"] = json!("available");
    call(&database, "classified", classify.clone())
        .await
        .unwrap();
    classify["postId"] = json!(3);
    classify["value"] = json!("deleted");
    call(&database, "classified", classify).await.unwrap();

    page["value"] = json!("commit");
    call(&database, "finish", page).await.unwrap();

    let status = call(&database, "status", json!({})).await.unwrap();
    assert_eq!(status["active"], 1);
    assert_eq!(status["archived"], 1);
    assert_eq!(status["deleted"], 1);

    let baseline = call(&database, "baseline", context).await.unwrap();
    assert_eq!(baseline["ids"], json!([1]));
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM posts")
        .fetch_one(&database.pool)
        .await
        .unwrap();
    assert_eq!(count, 3);
}

#[tokio::test]
async fn re_favorite_reactivates_failed_download() {
    let (_directory, database) = database().await;
    let lease = setup(&database).await;

    call(
        &database,
        "membership",
        json!({"postId": 5, "value": "favorited"}),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE download_queue SET attempt_count = 5")
        .execute(&database.pool)
        .await
        .unwrap();
    assert!(call(&database, "next", lease.clone()).await.unwrap()["postId"].is_null());

    call(
        &database,
        "membership",
        json!({"postId": 5, "value": "unfavorited"}),
    )
    .await
    .unwrap();
    call(
        &database,
        "membership",
        json!({"postId": 5, "value": "favorited"}),
    )
    .await
    .unwrap();

    assert_eq!(call(&database, "next", lease).await.unwrap()["postId"], 5);
}
