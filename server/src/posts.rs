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
use tracing::info;

use crate::{
    database::Database,
    ids::{PostId, Rule34UserId, TagId},
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
    Path(post_id): Path<PostId>,
    Query(account): Query<UploadAccount>,
    multipart: Multipart,
) -> AppResult<Json<Value>> {
    let data = PostData::from_multipart(multipart).await?;
    let processor = MediaProcessor::process(data.image).await?;
    let configured: Option<Rule34UserId> =
        sqlx::query_scalar("SELECT rule34_user_id FROM sync_account")
            .fetch_optional(&database.pool)
            .await?;
    if configured.map(|id| id.0) != Some(account.user_id.0) {
        return Ok(Json(serde_json::json!({"cancelled":true})));
    }
    // Copy across filesystems before acquiring the SQLite write lock. Publication
    // below is a same-filesystem rename, even for a large video upload.
    let staging = tempfile::tempdir_in(&base_path)?;
    let staging_path = camino::Utf8Path::from_path(staging.path())
        .ok_or_else(|| anyhow::anyhow!("non-UTF8 staging path"))?;
    tokio::fs::create_dir(staging_path.join(".thumbs")).await?;
    let storage_name = file_name(post_id, processor.extension);
    let extension = processor.extension;
    let mime = processor.mime;
    let original = processor.original;
    processor.commit(staging_path, post_id).await?;
    // Serialize final membership validation and publication against unfavorites.
    let mut trx = database.pool.begin_with("BEGIN IMMEDIATE").await?;
    let eligible: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM favorites f JOIN posts p USING(post_id) WHERE post_id=? AND (f.membership='favorited' OR (p.availability='deleted' AND f.membership!='unfavorited')))")
        .bind(post_id).fetch_one(&mut *trx).await?;
    if !eligible {
        return Ok(Json(serde_json::json!({"cancelled":true})));
    }
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM post_media WHERE post_id=?)")
            .bind(post_id)
            .fetch_one(&mut *trx)
            .await?;
    if !exists {
        tokio::fs::rename(
            staging_path.join(&storage_name),
            base_path.join(&storage_name),
        )
        .await?;
        let thumbnail = format!("{storage_name}.jpeg");
        if staging_path.join(".thumbs").join(&thumbnail).exists() {
            tokio::fs::rename(
                staging_path.join(".thumbs").join(&thumbnail),
                base_path.join(".thumbs").join(&thumbnail),
            )
            .await?;
        }
        sqlx::query("INSERT INTO post_media(post_id,storage_name,extension,mime,original) VALUES(?,?,?,?,?)")
            .bind(post_id).bind(storage_name).bind(extension).bind(mime).bind(original).execute(&mut *trx).await?;
        for tag in data.tags {
            sqlx::query("INSERT INTO tags(name,kind) VALUES(?,?) ON CONFLICT DO NOTHING")
                .bind(&tag.name)
                .bind(tag.kind.as_str())
                .execute(&mut *trx)
                .await?;
            let tag_id: TagId = sqlx::query_scalar("SELECT tag_id FROM tags WHERE name=?")
                .bind(tag.name)
                .fetch_one(&mut *trx)
                .await?;
            sqlx::query("INSERT INTO post_tags(post_id,tag_id) VALUES(?,?) ON CONFLICT DO NOTHING")
                .bind(post_id)
                .bind(tag_id)
                .execute(&mut *trx)
                .await?;
        }
    }
    sqlx::query("DELETE FROM download_queue WHERE post_id=?")
        .bind(post_id)
        .execute(&mut *trx)
        .await?;
    trx.commit().await?;
    info!(post_id = post_id.0, "Saved rule34 post");
    json_ok!({"ok": true})
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadAccount {
    user_id: Rule34UserId,
}

#[derive(Deserialize)]
pub struct DownloadedQuery {
    #[serde(default, deserialize_with = "parse_id_list")]
    ids: Option<Vec<PostId>>,
}

// The `ids` filter is a comma-separated list (`?ids=1,2,3`); the query
// deserializer wouldn't split it on its own. A value that isn't a list of
// post ids fails the query extraction, which axum answers with a 400.
fn parse_id_list<'de, D>(deserializer: D) -> Result<Option<Vec<PostId>>, D::Error>
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
        if id <= 0 {
            return Err(serde::de::Error::custom("post IDs must be positive"));
        }
        ids.push(PostId(id));
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
    Path(post_id): Path<PostId>,
    Query(MediaQuery { kind }): Query<MediaQuery>,
) -> impl IntoResponse {
    let (name, path, mime) = match database.get_post(post_id).await {
        Ok(post) => {
            let name = post.storage_name;
            let (path, mime) = if post.mime.starts_with("image") {
                (base_path.join(&name), post.mime)
            } else {
                // Videos are served as the JPEG poster ffmpeg generated at
                // upload time, not as the video itself.
                (
                    base_path.join(".thumbs").join(format!("{name}.jpeg")),
                    "image/jpeg".to_string(),
                )
            };
            if !path.is_file() {
                return Err((StatusCode::NOT_FOUND, "file not found on disk"));
            }
            (name, path, mime)
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
    async fn downloaded_post_ids(&self, requested: Option<&[PostId]>) -> Result<Vec<PostId>> {
        let Some(requested) = requested else {
            return Ok(sqlx::query_scalar("SELECT post_id FROM post_media")
                .fetch_all(&self.pool)
                .await?);
        };
        if requested.is_empty() {
            return Ok(Vec::new());
        }

        let mut query_builder =
            sqlx::QueryBuilder::new("SELECT post_id FROM post_media WHERE post_id IN (");
        query_builder.push_values(requested, |mut builder, post_id| {
            builder.push_bind(post_id);
        });
        query_builder.push(") ");

        Ok(query_builder
            .build_query_scalar()
            .fetch_all(&self.pool)
            .await?)
    }

    async fn get_download_count(&self) -> Result<i64> {
        Ok(sqlx::query_scalar!("SELECT COUNT(1) FROM post_media")
            .fetch_one(&self.pool)
            .await?)
    }

    async fn search(&self, search: &Search<'_>) -> Result<Vec<PostId>> {
        let mut query_builder = sqlx::QueryBuilder::new(
            r#"SELECT p.post_id
            FROM posts p
            JOIN post_tags pt ON p.post_id = pt.post_id
            JOIN tags t ON t.tag_id = pt.tag_id
            JOIN favorites f ON f.post_id=p.post_id
            WHERE f.membership!='unfavorited' AND (f.membership='favorited' OR p.availability='deleted') AND t.name IN "#,
        );
        query_builder.push_tuples(&search.include, |mut builder, term| {
            builder.push_bind(term);
        });
        query_builder.push(
            r#" GROUP BY p.post_id
            HAVING COUNT(1) = "#,
        );
        query_builder.push_bind(search.include.len() as i64);
        query_builder.push(" ORDER BY p.post_id DESC");

        Ok(query_builder
            .build_query_scalar()
            .fetch_all(&self.pool)
            .await?)
    }

    async fn get_post(&self, post_id: PostId) -> Result<PostMedia> {
        Ok(sqlx::query_as!(
            PostMedia,
            "SELECT storage_name,mime FROM post_media WHERE post_id=?",
            post_id.0
        )
        .fetch_one(&self.pool)
        .await?)
    }
}

struct PostMedia {
    storage_name: String,
    mime: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostIdsContainer {
    pub post_ids: Vec<PostId>,
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
