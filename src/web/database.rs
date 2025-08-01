use anyhow::{Context, Result};

use crate::{
    database::Database,
    web::models::{Post, Tag},
};

impl Database {
    pub async fn get_page(&self, limit: i64, offset: i64) -> Result<Vec<Post>> {
        sqlx::query_as!(
            Post,
            r#"
            SELECT p.id, d.file_name, d.mime
            FROM posts p 
            JOIN downloads d ON d.id = p.id 
            ORDER BY p.sort_id DESC
            LIMIT ? OFFSET ?"#,
            limit,
            offset
        )
        .fetch_all(&self.pool)
        .await
        .context("Could not get page from database")
    }

    pub async fn get_post_for_send_image(&self, post_id: i64) -> Result<Post> {
        sqlx::query_as!(
            Post,
            "SELECT id, file_name, mime FROM downloads WHERE id = ?",
            post_id
        )
        .fetch_one(&self.pool)
        .await
        .context("Could not get post for send image")
    }

    pub async fn get_tag_suggestions(&self, input: &str) -> Result<Vec<Tag>> {
        let like_string = format!("%{input}%");
        sqlx::query_as!(
            Tag,
            r#"SELECT 
                id "id!", 
                name "name!", 
                uses "uses!"
            FROM tags_with_uses 
            WHERE name LIKE ? 
            LIMIT 10"#,
            like_string
        )
        .fetch_all(&self.pool)
        .await
        .context("Could not get tag suggestions")
    }
}
