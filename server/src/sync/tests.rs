use camino::Utf8Path;
use serde_json::json;

use super::*;

async fn test_database() -> (tempfile::TempDir, Database) {
    let directory = tempfile::tempdir().unwrap();
    let path = Utf8Path::from_path(directory.path())
        .unwrap()
        .join("test.db");
    let database = Database::new(&path).await.unwrap();
    (directory, database)
}

async fn reconcile_ids(database: &Database, ids: &[i64], reported_count: i64) {
    let baseline = execute(database, &Command::Baseline).await.unwrap();
    execute(
        database,
        &Command::Reconcile {
            ids: ids.iter().copied().map(PostId).collect(),
            deleted: Vec::new(),
            reported_count,
            revision: baseline["revision"].as_i64().unwrap(),
        },
    )
    .await
    .unwrap();
}

#[test]
fn commands_require_their_own_fields() {
    for input in [
        json!({"action": "reconcile"}),
        json!({"action": "reconcile", "ids": [], "revision": 0}),
        json!({"action": "reconcile", "ids": [], "reportedCount": 0}),
        json!({"action": "membership", "postId": 1, "value": "invalid"}),
        json!({"action": "availability", "postId": 1, "value": "unknown"}),
    ] {
        assert!(serde_json::from_value::<Command>(input).is_err());
    }
    assert!(matches!(
        serde_json::from_value::<Command>(json!({
            "action": "reconcile", "ids": [], "reportedCount": 0, "revision": 0
        }))
        .unwrap(),
        Command::Reconcile { .. }
    ));
    assert!(matches!(
        serde_json::from_value::<Command>(json!({
            "action": "membership", "postId": 1, "value": "favorited"
        }))
        .unwrap(),
        Command::Membership {
            post_id: PostId(1),
            value: Membership::Favorited
        }
    ));
}

#[tokio::test]
async fn reconciliation_preserves_the_initial_offset_and_accepts_empty_orders() {
    let (_directory, database) = test_database().await;
    reconcile_ids(&database, &[30, 20, 10], 5).await;
    let first = execute(&database, &Command::Baseline).await.unwrap();
    assert_eq!(first["ids"], json!([30, 20, 10]));
    assert_eq!(first["countOffset"], 2);
    assert_eq!(first["initialized"], true);

    reconcile_ids(&database, &[], 0).await;
    let second = execute(&database, &Command::Baseline).await.unwrap();
    assert_eq!(second["ids"], json!([]));
    assert_eq!(second["countOffset"], 2);
    assert_eq!(second["revision"], 2);
}

#[tokio::test]
async fn observations_refresh_only_current_favorites() {
    let (_directory, database) = test_database().await;
    reconcile_ids(&database, &[10], 1).await;

    let observed = execute(
        &database,
        &Command::Observation {
            post_id: PostId(10),
            tags: vec![Tag {
                name: "current_tag".to_string(),
                kind: crate::posts::TagKind::General,
            }],
        },
    )
    .await
    .unwrap();
    assert_eq!(observed, json!({"observed": true}));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT t.name FROM tags t JOIN post_tags pt USING (tag_id) WHERE pt.post_id = 10"
        )
        .fetch_all(&database.pool)
        .await
        .unwrap(),
        vec!["current_tag"]
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT availability FROM posts WHERE post_id = 10")
            .fetch_one(&database.pool)
            .await
            .unwrap(),
        "available"
    );

    let ignored = execute(
        &database,
        &Command::Observation {
            post_id: PostId(20),
            tags: vec![Tag {
                name: "ignored_tag".to_string(),
                kind: crate::posts::TagKind::General,
            }],
        },
    )
    .await
    .unwrap();
    assert_eq!(ignored, json!({"observed": false}));
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM posts WHERE post_id = 20")
            .fetch_one(&database.pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn stale_reconciliation_cannot_undo_membership_or_another_reconciliation() {
    let (_directory, database) = test_database().await;
    reconcile_ids(&database, &[30, 20, 10], 3).await;
    let stale = Command::Reconcile {
        ids: vec![PostId(30), PostId(20), PostId(10)],
        deleted: Vec::new(),
        reported_count: 3,
        revision: 1,
    };

    for value in [Membership::Favorited, Membership::Unfavorited] {
        execute(
            &database,
            &Command::Membership {
                post_id: PostId(40),
                value,
            },
        )
        .await
        .unwrap();
        let before = execute(&database, &Command::Baseline).await.unwrap();
        assert!(matches!(
            execute(&database, &stale).await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(
            execute(&database, &Command::Baseline).await.unwrap(),
            before
        );
    }

    reconcile_ids(&database, &[50, 30], 2).await;
    assert!(matches!(
        execute(&database, &stale).await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(
        execute(&database, &Command::Baseline).await.unwrap()["ids"],
        json!([50, 30])
    );
}

#[tokio::test]
async fn invalid_reconciliation_leaves_state_unchanged() {
    let (_directory, database) = test_database().await;
    reconcile_ids(&database, &[1], 1).await;
    let before = execute(&database, &Command::Baseline).await.unwrap();
    for (ids, deleted, reported_count) in [
        (vec![PostId(1), PostId(1)], vec![], 2),
        (vec![PostId(1)], vec![PostId(1)], 1),
        (vec![PostId(0)], vec![], 1),
        (vec![PostId(1)], vec![PostId(-1)], 1),
        (vec![PostId(1)], vec![], -1),
    ] {
        let result = execute(
            &database,
            &Command::Reconcile {
                ids,
                deleted,
                reported_count,
                revision: 1,
            },
        )
        .await;
        assert!(matches!(result, Err(AppError::BadRequest(_))));
        assert_eq!(
            execute(&database, &Command::Baseline).await.unwrap(),
            before
        );
    }
}

#[tokio::test]
async fn membership_changes_do_not_rewrite_other_favorites() {
    let (_directory, database) = test_database().await;
    reconcile_ids(&database, &[30, 20, 10], 3).await;
    sqlx::query(
        r#"CREATE TRIGGER protect_other_favorites BEFORE DELETE ON favorite_order
        WHEN OLD.post_id != 10 BEGIN SELECT RAISE(ABORT, 'unrelated favorite deleted'); END;
        CREATE TRIGGER protect_other_positions BEFORE UPDATE ON favorite_order
        WHEN OLD.post_id != 10 BEGIN SELECT RAISE(ABORT, 'unrelated favorite updated'); END;"#,
    )
    .execute(&database.pool)
    .await
    .unwrap();

    execute(
        &database,
        &Command::Membership {
            post_id: PostId(10),
            value: Membership::Favorited,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        execute(&database, &Command::Baseline).await.unwrap()["ids"],
        json!([10, 30, 20])
    );
    assert_eq!(
        execute(&database, &Command::Downloads).await.unwrap()["ids"],
        json!([10, 30, 20])
    );
    execute(
        &database,
        &Command::Membership {
            post_id: PostId(10),
            value: Membership::Unfavorited,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        execute(&database, &Command::Baseline).await.unwrap()["ids"],
        json!([30, 20])
    );
}

#[tokio::test]
async fn migration_preserves_an_existing_sync_database() {
    let directory = tempfile::tempdir().unwrap();
    let path = Utf8Path::from_path(directory.path())
        .unwrap()
        .join("test.db");
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true),
    )
    .await
    .unwrap();
    for migration in [
        include_str!("../migrations/202508291609-init.sql"),
        include_str!("../migrations/20260906-sync.sql"),
    ] {
        sqlx::query(migration).execute(&pool).await.unwrap();
    }
    sqlx::query(
        r#"INSERT INTO posts (post_id) VALUES (10), (20);
        INSERT INTO favorite_order (position, post_id) VALUES (0, 20), (1, 10);
        UPDATE sync_state SET initialized = 1, count_offset = 7, last_sync_at = 123;
        PRAGMA user_version = 2;"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;

    let database = Database::new(&path).await.unwrap();
    assert_eq!(
        execute(&database, &Command::Baseline).await.unwrap(),
        json!({
            "ids": [20, 10], "initialized": true, "countOffset": 7, "revision": 0,
        })
    );
    assert_eq!(
        execute(&database, &Command::Status).await.unwrap()["lastSyncAt"],
        123
    );
    execute(
        &database,
        &Command::Membership {
            post_id: PostId(30),
            value: Membership::Favorited,
        },
    )
    .await
    .unwrap();
    database.pool.close().await;

    let reopened = Database::new(&path).await.unwrap();
    assert_eq!(
        execute(&reopened, &Command::Baseline).await.unwrap()["ids"],
        json!([30, 20, 10])
    );
    assert!(
        sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&reopened.pool)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn reconciliation_records_deletions_and_refavoriting_restores_availability() {
    let (_directory, database) = test_database().await;
    reconcile_ids(&database, &[30, 20, 10], 3).await;
    execute(
        &database,
        &Command::Reconcile {
            ids: vec![PostId(30), PostId(10)],
            deleted: vec![PostId(20)],
            reported_count: 2,
            revision: 1,
        },
    )
    .await
    .unwrap();
    let membership = execute(
        &database,
        &Command::Memberships {
            ids: vec![PostId(20)],
        },
    )
    .await
    .unwrap();
    assert_eq!(membership["posts"][0]["availability"], "deleted");
    assert_eq!(membership["posts"][0]["membership"], "unfavorited");

    execute(
        &database,
        &Command::Membership {
            post_id: PostId(20),
            value: Membership::Favorited,
        },
    )
    .await
    .unwrap();
    let membership = execute(
        &database,
        &Command::Memberships {
            ids: vec![PostId(20)],
        },
    )
    .await
    .unwrap();
    assert_eq!(membership["posts"][0]["availability"], "unknown");
    assert_eq!(
        execute(&database, &Command::Downloads).await.unwrap()["ids"],
        json!([20, 30, 10])
    );
}
