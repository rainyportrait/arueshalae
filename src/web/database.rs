use anyhow::{Context, Result};
use serde::Deserialize;

use crate::{
    database::Database,
    web::models::{Post, Tag},
};

pub const POSTS_PER_PAGE: i64 = 48;

#[derive(Deserialize)]
pub struct PageQuery {
    pub page: Option<i64>,
}

impl Database {
    pub async fn get_page(&self, query: &PageQuery) -> Result<(Vec<Post>, u64)> {
        let offset = (query.page.unwrap_or(1) - 1) * POSTS_PER_PAGE;

        let posts = sqlx::query_as!(
            Post,
            r#"
            SELECT p.id, d.file_name, d.mime
            FROM posts p 
            JOIN downloads d ON d.id = p.id 
            ORDER BY p.sort_id DESC
            LIMIT ? OFFSET ?"#,
            POSTS_PER_PAGE,
            offset
        )
        .fetch_all(&self.pool)
        .await?;

        let total_post_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(1) "count: u64"
            FROM posts p 
            JOIN downloads d ON d.id = p.id 
            "#
        )
        .fetch_one(&self.pool)
        .await?;

        Ok((posts, total_post_count))
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
