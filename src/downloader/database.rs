use std::collections::HashSet;

use anyhow::Result;

use crate::database::Database;

impl Database {
    pub async fn insert_posts(&self, post_ids: &[i64]) -> Result<Vec<i64>> {
        if post_ids.is_empty() {
            println!("Got no post ids.");
            return Ok(Vec::new());
        }

        let mut query_builder = sqlx::QueryBuilder::new("INSERT INTO posts (id) ");
        query_builder.push_values(post_ids, |mut builder, post_id| {
            builder.push_bind(post_id);
        });
        query_builder.push("ON CONFLICT DO NOTHING ");
        query_builder.push("RETURNING id");
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
            SELECT p.id 
            FROM posts p 
            WHERE p.id NOT IN (
                SELECT d.id 
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
        space_seperated_tags: &str,
    ) -> Result<()> {
        let mut transaction = self.pool.begin().await?;

        sqlx::query!(
            r#"INSERT INTO downloads (id, file_name, mime, original) VALUES (?, ?, ?, ?)"#,
            post_id,
            file_name,
            mime,
            original,
        )
        .execute(&self.pool)
        .await?;

        let tags = space_seperated_tags
            .split(" ")
            .map(|tag| tag.trim().to_lowercase())
            .filter(|tag| !tag.is_empty())
            .collect::<HashSet<String>>();

        for tag in tags {
            sqlx::query!(
                "INSERT INTO tags (name) VALUES (?) ON CONFLICT DO NOTHING",
                tag
            )
            .execute(&mut *transaction)
            .await?;

            sqlx::query!(
                "INSERT INTO post_tags (post_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))",
                post_id,
                tag,
            )
            .execute(&mut *transaction)
            .await?;
        }

        transaction.commit().await?;
        Ok(())
    }

    pub async fn get_sort_id_for_post(&self, post_id: i64) -> Result<i64> {
        sqlx::query_scalar!("SELECT sort_id FROM posts WHERE id = ?", post_id)
            .fetch_one(&self.pool)
            .await
            .map_err(anyhow::Error::from)
    }
}
