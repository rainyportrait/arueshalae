use anyhow::Result;

use crate::database::Database;

impl Database {
    pub async fn insert_posts(&self, post_ids: &[i64]) -> Result<Vec<i64>> {
        if post_ids.is_empty() {
            println!("Got no post ids.");
            return Ok(Vec::new());
        }

        let mut query_builder = sqlx::QueryBuilder::new("INSERT INTO posts (remote_id) ");
        query_builder.push_values(post_ids, |mut builder, post_id| {
            builder.push_bind(post_id);
        });
        query_builder.push("ON CONFLICT DO NOTHING ");
        query_builder.push("RETURNING remote_id");
        let new_post_ids = query_builder
            .build_query_scalar()
            .fetch_all(&self.pool)
            .await?;

        Ok(new_post_ids)
    }

    pub async fn post_count(&self) -> Result<i64> {
        sqlx::query_scalar!("SELECT COUNT(1) FROM posts")
            .fetch_one(&self.pool)
            .await
            .map_err(anyhow::Error::from)
    }

    pub async fn pending_posts(&self) -> Result<Vec<i64>> {
        sqlx::query_scalar!(
            r#"
            SELECT p.remote_id 
            FROM posts p 
            WHERE p.id NOT IN (
                SELECT d.post_id 
                FROM downloads d
            )
            ORDER BY p.id DESC"#
        )
        .fetch_all(&self.pool)
        .await
        .map_err(anyhow::Error::from)
    }

    pub async fn insert_download(
        &self,
        post_id: i64,
        file_name: &str,
        mime: &str,
        original: bool,
    ) -> Result<()> {
        sqlx::query!(
            r#"INSERT INTO downloads (post_id, file_name, mime, original) 
            VALUES (
                (SELECT p.id FROM posts p WHERE p.remote_id = ?), 
                ?, ?, ?)"#,
            post_id,
            file_name,
            mime,
            original,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_internal_post_id(&self, remote_id: i64) -> Result<i64> {
        sqlx::query_scalar!("SELECT id FROM posts WHERE remote_id = ?", remote_id)
            .fetch_one(&self.pool)
            .await
            .map_err(anyhow::Error::from)
    }
}
