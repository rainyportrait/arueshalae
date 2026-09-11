use anyhow::{Context, Result};
use axum::{Json, extract::State};
use camino::{Utf8Path, Utf8PathBuf};
use serde_json::Value;
use sqlx::SqliteConnection;
use tempfile::TempDir;

use crate::{
    json_ok,
    server::{AppResult, AppState},
};

struct Candidate {
    post_id: i64,
    storage_name: Option<String>,
}

pub async fn get_prune_preview(
    State(AppState { database, .. }): State<AppState>,
) -> AppResult<Json<Value>> {
    let mut transaction = database.pool.begin().await?;
    let count = candidate_count(&mut transaction).await?;
    transaction.commit().await?;
    json_ok!({"posts": count})
}

pub async fn prune(
    State(AppState {
        database,
        base_path,
    }): State<AppState>,
) -> AppResult<Json<Value>> {
    let mut transaction = database.pool.begin_with("BEGIN IMMEDIATE").await?;
    let candidates = candidates(&mut transaction).await?;
    let mut staged = StagedFiles::new(&base_path)?;

    if let Err(error) = staged.move_candidates(&base_path, &candidates).await {
        staged.restore(&base_path).await?;
        return Err(error.into());
    }

    let result = delete_candidates(&mut transaction, &candidates).await;
    if let Err(error) = result {
        transaction.rollback().await?;
        staged.restore(&base_path).await?;
        return Err(error.into());
    }

    if let Err(error) = transaction.commit().await {
        staged.restore(&base_path).await?;
        return Err(error.into());
    }

    json_ok!({
        "posts": candidates.len(),
        "postIds": candidates.iter().map(|candidate| candidate.post_id).collect::<Vec<_>>(),
    })
}

async fn candidate_count(connection: &mut SqliteConnection) -> Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT CASE WHEN s.initialized THEN COUNT(p.post_id) ELSE 0 END AS "count!: i64"
        FROM sync_state s
        LEFT JOIN posts p
          ON p.status = 'unfavorited'
         AND NOT EXISTS (SELECT 1 FROM favorite_order f WHERE f.post_id = p.post_id)
        WHERE s.singleton = 1"#,
    )
    .fetch_one(connection)
    .await?)
}

async fn candidates(connection: &mut SqliteConnection) -> Result<Vec<Candidate>> {
    Ok(sqlx::query_as!(
        Candidate,
        r#"SELECT p.post_id, m.storage_name
        FROM posts p
        LEFT JOIN post_media m USING (post_id)
        WHERE p.status = 'unfavorited'
          AND NOT EXISTS (SELECT 1 FROM favorite_order f WHERE f.post_id = p.post_id)
          AND (SELECT initialized FROM sync_state WHERE singleton = 1)"#,
    )
    .fetch_all(connection)
    .await?)
}

async fn delete_candidates(
    connection: &mut SqliteConnection,
    candidates: &[Candidate],
) -> Result<()> {
    for candidate in candidates {
        sqlx::query!("DELETE FROM post_tags WHERE post_id = ?", candidate.post_id)
            .execute(&mut *connection)
            .await?;
        sqlx::query!(
            "DELETE FROM post_media WHERE post_id = ?",
            candidate.post_id
        )
        .execute(&mut *connection)
        .await?;
        sqlx::query!("DELETE FROM posts WHERE post_id = ?", candidate.post_id)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

struct StagedFile {
    original: Utf8PathBuf,
    staged: Utf8PathBuf,
}

struct StagedFiles {
    directory: TempDir,
    files: Vec<StagedFile>,
}

impl StagedFiles {
    fn new(base_path: &Utf8Path) -> Result<Self> {
        Ok(Self {
            directory: tempfile::tempdir_in(base_path)?,
            files: Vec::new(),
        })
    }

    async fn move_candidates(
        &mut self,
        base_path: &Utf8Path,
        candidates: &[Candidate],
    ) -> Result<()> {
        for candidate in candidates {
            let Some(storage_name) = &candidate.storage_name else {
                continue;
            };
            for original in [
                base_path.join(storage_name),
                base_path
                    .join(".thumbs")
                    .join(format!("{storage_name}.jpeg")),
                base_path
                    .join(".minis")
                    .join(format!("mini_{storage_name}.jpeg")),
            ] {
                if !original.exists() {
                    continue;
                }
                let staged = Utf8Path::from_path(self.directory.path())
                    .context("non-UTF8 prune staging path")?
                    .join(self.files.len().to_string());
                tokio::fs::rename(&original, &staged)
                    .await
                    .with_context(|| format!("failed to stage pruned media file {original}"))?;
                self.files.push(StagedFile { original, staged });
            }
        }
        Ok(())
    }

    async fn restore(&mut self, base_path: &Utf8Path) -> Result<()> {
        for file in self.files.drain(..).rev() {
            if let Some(parent) = file.original.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::rename(&file.staged, &file.original)
                .await
                .with_context(|| format!("failed to restore media file under {base_path}"))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use camino::Utf8Path;
    use tempfile::tempdir;

    use super::*;
    use crate::database::Database;

    #[tokio::test]
    async fn prune_requires_a_baseline_and_keeps_favorites_and_deleted_posts() {
        let directory = tempdir().unwrap();
        let base_path = Utf8Path::from_path(directory.path()).unwrap();
        tokio::fs::create_dir(base_path.join(".thumbs"))
            .await
            .unwrap();
        tokio::fs::create_dir(base_path.join(".minis"))
            .await
            .unwrap();
        let database = Database::new(&base_path.join("test.db")).await.unwrap();

        sqlx::query(
            r#"INSERT INTO posts (post_id, status) VALUES
                (1, 'favorited'), (2, 'unfavorited'), (3, 'deleted'), (4, 'unknown');
            INSERT INTO post_media (post_id, storage_name, extension, mime, original) VALUES
                (1, '1.jpg', 'jpg', 'image/jpeg', 1),
                (2, '2.mp4', 'mp4', 'video/mp4', 1),
                (3, '3.jpg', 'jpg', 'image/jpeg', 1);
            INSERT INTO favorite_order (position, post_id) VALUES (0, 1)"#,
        )
        .execute(&database.pool)
        .await
        .unwrap();

        for path in [
            "1.jpg",
            "2.mp4",
            "3.jpg",
            ".thumbs/2.mp4.jpeg",
            ".minis/mini_2.mp4.jpeg",
        ] {
            tokio::fs::write(base_path.join(path), b"media")
                .await
                .unwrap();
        }

        let preview = get_prune_preview(State(AppState {
            database: database.clone(),
            base_path: base_path.to_path_buf(),
        }))
        .await
        .unwrap();
        assert_eq!(preview.0["posts"], 0);

        sqlx::query("UPDATE sync_state SET initialized = 1")
            .execute(&database.pool)
            .await
            .unwrap();
        let preview = get_prune_preview(State(AppState {
            database: database.clone(),
            base_path: base_path.to_path_buf(),
        }))
        .await
        .unwrap();
        assert_eq!(preview.0["posts"], 1);

        let response = prune(State(AppState {
            database: database.clone(),
            base_path: base_path.to_path_buf(),
        }))
        .await
        .unwrap();
        assert_eq!(response.0["posts"], 1);
        assert_eq!(response.0["postIds"], serde_json::json!([2]));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT post_id FROM posts ORDER BY post_id")
                .fetch_all(&database.pool)
                .await
                .unwrap(),
            vec![1, 3, 4]
        );
        for path in ["2.mp4", ".thumbs/2.mp4.jpeg", ".minis/mini_2.mp4.jpeg"] {
            assert!(!base_path.join(path).exists(), "{path} was not removed");
        }
        for path in ["1.jpg", "3.jpg"] {
            assert!(
                base_path.join(path).exists(),
                "{path} was unexpectedly removed"
            );
        }
    }
}
