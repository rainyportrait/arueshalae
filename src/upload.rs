use std::io::Write;

use anyhow::{Context, Result};
use axum::{
    Json,
    extract::{Multipart, State},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tempfile::NamedTempFile;
use tracing::info;

use crate::{
    database::Database,
    json_ok,
    media_processor::MediaProcessor,
    server::{AppResult, AppState},
};

pub async fn upload(
    State(AppState {
        database,
        base_path,
        ..
    }): State<AppState>,
    multipart: Multipart,
) -> AppResult<Json<Value>> {
    let data = PostData::from_multipart(multipart).await?;
    let processor = MediaProcessor::process(data.image).await?;
    let post_id = database
        .insert_post(
            data.id,
            processor.extension,
            processor.mime,
            processor.original,
            &data.tags,
        )
        .await?;
    info!(
        "Saved https://rule34.xxx/index.php?page=post&s=view&id={}",
        data.id
    );
    processor.commit(&base_path, post_id, data.id).await?;
    json_ok!({"ok": true})
}

pub async fn check_download_status(
    State(AppState { database, .. }): State<AppState>,
    Json(PostIdsResponse { post_ids }): Json<PostIdsResponse>,
) -> AppResult<Json<PostIdsResponse>> {
    let existing_ids = database.filter_already_downloaded_posts(&post_ids).await?;
    Ok(Json(PostIdsResponse {
        post_ids: existing_ids,
    }))
}

pub async fn get_download_count(
    State(AppState { database, .. }): State<AppState>,
) -> AppResult<Json<Value>> {
    json_ok!({"count": database.get_download_count().await?})
}

impl Database {
    pub async fn filter_already_downloaded_posts(&self, post_ids: &[i64]) -> Result<Vec<i64>> {
        if post_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut query_builder =
            sqlx::QueryBuilder::new("SELECT external_id FROM posts WHERE external_id IN (");
        query_builder.push_values(post_ids, |mut builder, post_id| {
            builder.push_bind(post_id);
        });
        query_builder.push(") ");

        Ok(query_builder
            .build_query_scalar()
            .fetch_all(&self.pool)
            .await?)
    }

    pub async fn insert_post(
        &self,
        external_id: i64,
        extension: &str,
        mime: &str,
        original: bool,
        tags: &[Tag],
    ) -> Result<i64> {
        let mut trx = self.pool.begin().await?;

        let id = sqlx::query_scalar!("SELECT id FROM posts WHERE external_id = ?", external_id)
            .fetch_optional(&mut *trx)
            .await?;

        let id = if let Some(id) = id {
            id
        } else {
            sqlx::query_scalar!(
                r#"INSERT INTO posts (external_id, extension, mime, original) 
                VALUES (?, ?, ?, ?) 
                RETURNING id"#,
                external_id,
                extension,
                mime,
                original
            )
            .fetch_one(&mut *trx)
            .await?
        };

        for tag in tags {
            let kind = tag.kind.as_str();
            sqlx::query!(
                "INSERT INTO tags (name, kind) VALUES (?, ?) ON CONFLICT DO NOTHING",
                tag.name,
                kind,
            )
            .execute(&mut *trx)
            .await?;

            sqlx::query!(
                r#"INSERT INTO post_tags (post_id, tag_id) 
                VALUES (?, (SELECT id FROM tags WHERE name = ?))"#,
                id,
                tag.name
            )
            .execute(&mut *trx)
            .await?;
        }

        trx.commit().await?;

        Ok(id)
    }

    async fn get_download_count(&self) -> Result<i64> {
        Ok(sqlx::query_scalar!("SELECT COUNT(1) FROM posts")
            .fetch_one(&self.pool)
            .await?)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostIdsResponse {
    pub post_ids: Vec<i64>,
}

pub struct PostData {
    pub id: i64,
    pub image: NamedTempFile,
    pub tags: Vec<Tag>,
}

#[derive(Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    pub kind: TagKind,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TagKind {
    Copyright,
    Character,
    Artist,
    General,
    Metadata,
}

impl TagKind {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Copyright => "copyright",
            Self::Character => "character",
            Self::Artist => "artist",
            Self::General => "general",
            Self::Metadata => "metadata",
        }
    }
}

impl PostData {
    pub async fn from_multipart(mut value: Multipart) -> Result<Self> {
        let mut id: Option<i64> = None;
        let mut image: Option<NamedTempFile> = None;
        let mut tags: Option<Vec<Tag>> = None;

        while let Some(mut field) = value
            .next_field()
            .await
            .context("Failed to get next field")?
        {
            let name = field.name().unwrap_or("").to_string();

            match name.as_str() {
                "id" => {
                    let data = field.text().await?;
                    id = Some(
                        data.trim()
                            .parse::<i64>()
                            .context("Failed to parse id as i64")?,
                    );
                }
                "image" => {
                    let mut tmp =
                        NamedTempFile::new().context("Failed to create temp file for image")?;
                    while let Some(chunk) = field.chunk().await? {
                        tmp.write_all(&chunk).context("Failed writing image data")?;
                    }
                    image = Some(tmp);
                }
                "tags" => {
                    let data = field.text().await?;
                    let t: Vec<Tag> =
                        serde_json::from_str(&data).context("Invalid JSON for tags")?;
                    tags = Some(t);
                }
                _ => {
                    // Ignore unknown fields
                }
            }
        }

        // Validate required fields
        let id = id.ok_or_else(|| anyhow::anyhow!("missing field: id"))?;
        let image = image.ok_or_else(|| anyhow::anyhow!("missing field: image"))?;
        let tags = tags.unwrap_or_default();

        Ok(PostData { id, image, tags })
    }
}
