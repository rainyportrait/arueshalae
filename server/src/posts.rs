use std::io::Write;

use anyhow::{Context, Result};
use axum::{
    Json,
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tempfile::NamedTempFile;
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use tracing::{error, info, warn};

use crate::{
    database::Database,
    json_ok,
    media_processor::{MediaProcessor, file_name, mini_thumb},
    server::{AppResult, AppState, SearchQuery},
};

pub async fn create_post(
    State(AppState {
        database,
        base_path,
        ..
    }): State<AppState>,
    Path(post_id): Path<i64>,
    multipart: Multipart,
) -> AppResult<Json<Value>> {
    let data = PostData::from_multipart(multipart).await?;
    let processor = MediaProcessor::process(data.image).await?;
    let row_id = database
        .insert_post(
            post_id,
            processor.extension,
            processor.mime,
            processor.original,
            &data.tags,
        )
        .await?;
    info!(
        "Saved https://rule34.xxx/index.php?page=post&s=view&id={}",
        post_id
    );
    processor.commit(&base_path, row_id, post_id).await?;
    json_ok!({"ok": true})
}

pub async fn delete_post(
    State(AppState {
        database,
        base_path,
        ..
    }): State<AppState>,
    Path(post_id): Path<i64>,
) -> impl IntoResponse {
    let post = match database.delete_post(post_id).await {
        Ok(post) => post,
        Err(err) => {
            error!("failed to delete post {post_id}: {err}");
            return Err((StatusCode::INTERNAL_SERVER_ERROR, "failed to delete post"));
        }
    };
    let Some(post) = post else {
        return Err((StatusCode::NOT_FOUND, "post not found"));
    };

    // The files go after the commit, best-effort: an orphaned file can never
    // be served (its row is gone) and there is no retry path, so a warn! is
    // the right ceiling.
    let name = file_name(post.id, post.external_id, &post.extension);
    for path in [
        base_path.join(&name),
        base_path.join(".thumbs").join(format!("{name}.jpeg")),
        base_path.join(".minis").join(format!("mini_{name}.jpeg")),
    ] {
        if let Err(err) = tokio::fs::remove_file(path.as_path()).await {
            if err.kind() != std::io::ErrorKind::NotFound {
                warn!("failed to remove {}: {err}", path);
            }
        }
    }

    json_ok!({"ok": true})
}

#[derive(Deserialize)]
pub struct DownloadedQuery {
    #[serde(default, deserialize_with = "parse_id_list")]
    ids: Option<Vec<i64>>,
}

// The `ids` filter is a comma-separated list (`?ids=1,2,3`); the query
// deserializer wouldn't split it on its own. A value that isn't a list of
// post ids fails the query extraction, which axum answers with a 400.
fn parse_id_list<'de, D>(deserializer: D) -> Result<Option<Vec<i64>>, D::Error>
where
    D: serde::de::Deserializer<'de>,
{
    let Some(raw) = Option::<String>::deserialize(deserializer)? else {
        return Ok(None);
    };
    let mut ids = Vec::new();
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let id = part
            .parse::<i64>()
            .map_err(|_| serde::de::Error::custom(format!("invalid post id {part:?} in ids")))?;
        ids.push(id);
    }
    Ok(Some(ids))
}

pub async fn list_downloaded_posts(
    State(AppState { database, .. }): State<AppState>,
    Query(DownloadedQuery { ids }): Query<DownloadedQuery>,
) -> AppResult<Json<PostIdsContainer>> {
    let post_ids = database.downloaded_post_ids(ids.as_deref()).await?;
    Ok(Json(PostIdsContainer { post_ids }))
}

pub struct Search<'a> {
    include: Vec<&'a str>,
    exclude: Vec<&'a str>,
}

impl<'a> Search<'a> {
    fn new(input: &'a str) -> Self {
        let mut result = Self {
            include: Vec::new(),
            exclude: Vec::new(),
        };

        for term in input.split_whitespace() {
            if let Some(t) = term.strip_prefix("-") {
                if !t.is_empty() {
                    result.exclude.push(t)
                }
            } else {
                result.include.push(term)
            }
        }

        result
    }
}

pub async fn search(
    State(AppState { database, .. }): State<AppState>,
    Query(SearchQuery { term }): Query<SearchQuery>,
) -> AppResult<Json<PostIdsContainer>> {
    let search = Search::new(&term);
    let post_ids = database.search(&search).await?;
    Ok(Json(PostIdsContainer { post_ids }))
}

pub async fn get_download_count(
    State(AppState { database, .. }): State<AppState>,
) -> AppResult<Json<Value>> {
    json_ok!({"count": database.get_download_count().await?})
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum MediaKind {
    #[default]
    Image,
    Mini,
}

#[derive(Deserialize)]
pub struct MediaQuery {
    #[serde(default, rename = "type")]
    kind: MediaKind,
}

pub async fn serve_media(
    State(AppState {
        database,
        base_path,
        ..
    }): State<AppState>,
    Path(post_id): Path<i64>,
    Query(MediaQuery { kind }): Query<MediaQuery>,
) -> impl IntoResponse {
    let (name, path, mime) = match database.get_post(post_id).await {
        Ok(post) => {
            let name = file_name(post.id, post.external_id, &post.extension);
            let path = if post.mime.starts_with("image") {
                base_path.join(&name)
            } else {
                base_path.join(".thumbs").join(format!("{name}.jpeg"))
            };
            if !path.is_file() {
                return Err((StatusCode::NOT_FOUND, "file not found on disk"));
            }
            (name, path, post.mime)
        }
        Err(_) => return Err((StatusCode::NOT_FOUND, "post not found in database")),
    };

    let (path, mime) = match kind {
        MediaKind::Image => (path, mime),
        MediaKind::Mini => match mini_thumb(&name, &path, &base_path).await {
            Ok(path) => (path, "image/jpeg".to_string()),
            Err(_) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to create mini thumb",
                ));
            }
        },
    };

    let file = match File::open(&path).await {
        Ok(file) => file,
        Err(_) => return Err((StatusCode::NOT_FOUND, "unable to open file")),
    };

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(([(header::CONTENT_TYPE, mime)], body))
}

impl Database {
    // Which of the requested posts the library holds; without a request, the
    // whole library. The ids come back in no particular order.
    async fn downloaded_post_ids(&self, requested: Option<&[i64]>) -> Result<Vec<i64>> {
        let Some(requested) = requested else {
            return Ok(sqlx::query_scalar!("SELECT external_id FROM posts")
                .fetch_all(&self.pool)
                .await?);
        };
        if requested.is_empty() {
            return Ok(Vec::new());
        }

        let mut query_builder =
            sqlx::QueryBuilder::new("SELECT external_id FROM posts WHERE external_id IN (");
        query_builder.push_values(requested, |mut builder, post_id| {
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

            // Idempotent: re-uploading a known post (a client retry) must
            // not trip the (post_id, tag_id) primary key.
            sqlx::query!(
                r#"INSERT INTO post_tags (post_id, tag_id) 
                VALUES (?, (SELECT id FROM tags WHERE name = ?))
                ON CONFLICT DO NOTHING"#,
                id,
                tag.name
            )
            .execute(&mut *trx)
            .await?;
        }

        trx.commit().await?;

        Ok(id)
    }

    async fn delete_post(&self, external_id: i64) -> Result<Option<PostRow>> {
        let mut trx = self.pool.begin().await?;

        let Some(post) = sqlx::query_as!(
            PostRow,
            r#"SELECT id, external_id, extension
            FROM posts
            WHERE external_id = ?"#,
            external_id
        )
        .fetch_optional(&mut *trx)
        .await?
        else {
            return Ok(None);
        };

        sqlx::query("DELETE FROM post_tags WHERE post_id = ?")
            .bind(post.id)
            .execute(&mut *trx)
            .await?;

        sqlx::query("DELETE FROM posts WHERE id = ?")
            .bind(post.id)
            .execute(&mut *trx)
            .await?;

        // Prune tags orphaned by this delete: deletion is the first thing
        // that can orphan a tag, and autocomplete queries tags_with_uses
        // without a uses > 0 filter, so unpruned orphans would become
        // suggestable dead tags. (With post_tags empty, NOT IN matches every
        // tag row — deleting them all is correct.)
        sqlx::query("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM post_tags)")
            .execute(&mut *trx)
            .await?;

        trx.commit().await?;

        Ok(Some(post))
    }

    async fn get_download_count(&self) -> Result<i64> {
        Ok(sqlx::query_scalar!("SELECT COUNT(1) FROM posts")
            .fetch_one(&self.pool)
            .await?)
    }

    async fn search(&self, search: &Search<'_>) -> Result<Vec<i64>> {
        let mut query_builder = sqlx::QueryBuilder::new(
            r#"SELECT p.external_id 
            FROM posts p
            JOIN post_tags pt ON p.id = pt.post_id
            JOIN tags t ON t.id = pt.tag_id
            WHERE t.name IN "#,
        );
        query_builder.push_tuples(&search.include, |mut builder, term| {
            builder.push_bind(term);
        });
        query_builder.push(
            r#" GROUP BY p.external_id
            HAVING COUNT(1) = "#,
        );
        query_builder.push_bind(search.include.len() as i64);
        query_builder.push(" ORDER BY p.id DESC");

        Ok(query_builder
            .build_query_scalar()
            .fetch_all(&self.pool)
            .await?)
    }

    async fn get_post(&self, external_id: i64) -> Result<PostMedia> {
        Ok(sqlx::query_as!(
            PostMedia,
            r#"SELECT id, external_id, extension, mime
            FROM posts
            WHERE external_id = ?
            "#,
            external_id
        )
        .fetch_one(&self.pool)
        .await?)
    }
}

// The stored media of a post: enough of the row to compute the file names
// and pick the content type for serving.
struct PostMedia {
    id: i64,
    external_id: i64,
    extension: String,
    mime: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostIdsContainer {
    pub post_ids: Vec<i64>,
}

// A post row: the ids and extension needed to compute the post's file names
// after the row itself is deleted.
struct PostRow {
    id: i64,
    external_id: i64,
    extension: String,
}

pub struct PostData {
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
        let mut image: Option<NamedTempFile> = None;
        let mut tags: Option<Vec<Tag>> = None;

        while let Some(mut field) = value
            .next_field()
            .await
            .context("Failed to get next field")?
        {
            let name = field.name().unwrap_or("").to_string();

            match name.as_str() {
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

        let image = image.ok_or_else(|| anyhow::anyhow!("missing field: image"))?;
        let tags = tags.unwrap_or_default();

        Ok(PostData { image, tags })
    }
}
