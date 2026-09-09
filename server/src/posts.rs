use std::{io::ErrorKind, io::Write};

use anyhow::{Context, Result};
use axum::{
    Json,
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::header,
    response::IntoResponse,
};
use camino::Utf8Path;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqliteConnection;
use tempfile::{NamedTempFile, TempDir};
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use tracing::info;

use crate::{
    database::Database,
    ids::{PostId, TagId},
    json_ok,
    media_processor::{MediaProcessor, MediaProcessorResult, file_name, mini_thumb},
    server::{AppError, AppResult, AppState, SearchQuery},
};

pub async fn create_post(
    State(AppState {
        database,
        base_path,
        ..
    }): State<AppState>,
    Path(post_id): Path<PostId>,
    multipart: Multipart,
) -> AppResult<Json<Value>> {
    let data = PostData::from_multipart(multipart).await?;
    let processor = MediaProcessor::process(data.image).await?;

    let media = StagedMedia::new(&base_path, post_id, processor).await?;
    if !database
        .save_post(&base_path, post_id, &media, &data.tags)
        .await?
    {
        return Ok(Json(serde_json::json!({"cancelled": true})));
    }

    info!(post_id = post_id.0, "Saved rule34 post");
    json_ok!({"ok": true})
}

struct StagedMedia {
    directory: TempDir,
    storage_name: String,
    extension: &'static str,
    mime: &'static str,
    original: bool,
}

impl StagedMedia {
    async fn new(
        base_path: &Utf8Path,
        post_id: PostId,
        processor: MediaProcessorResult,
    ) -> Result<Self> {
        // Copy across filesystems before acquiring the SQLite write lock.
        // Publishing from here is a same-filesystem rename, even for a large video.
        let directory = tempfile::tempdir_in(base_path)?;
        let path = Utf8Path::from_path(directory.path())
            .ok_or_else(|| anyhow::anyhow!("non-UTF8 staging path"))?;

        tokio::fs::create_dir(path.join(".thumbs")).await?;

        let media = Self {
            directory,
            storage_name: file_name(post_id, processor.extension),
            extension: processor.extension,
            mime: processor.mime,
            original: processor.original,
        };
        processor.commit(media.path(), post_id).await?;

        Ok(media)
    }

    async fn publish(&self, base_path: &Utf8Path) -> Result<()> {
        tokio::fs::rename(
            self.path().join(&self.storage_name),
            base_path.join(&self.storage_name),
        )
        .await?;

        let thumbnail = format!("{}.jpeg", self.storage_name);
        let staged_thumbnail = self.path().join(".thumbs").join(&thumbnail);
        if staged_thumbnail.exists() {
            tokio::fs::rename(staged_thumbnail, base_path.join(".thumbs").join(thumbnail)).await?;
        }

        Ok(())
    }

    fn path(&self) -> &Utf8Path {
        Utf8Path::from_path(self.directory.path()).expect("staging path was already validated")
    }
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
) -> AppResult<impl IntoResponse> {
    let Some(post) = database.get_post(post_id).await? else {
        return Err(AppError::not_found("post not found"));
    };
    let name = post.storage_name;
    let (path, mime) = if post.mime.starts_with("image") {
        (base_path.join(&name), post.mime)
    } else {
        // Videos are served as the JPEG poster ffmpeg generated at upload time,
        // not as the video itself.
        (
            base_path.join(".thumbs").join(format!("{name}.jpeg")),
            "image/jpeg".to_string(),
        )
    };

    let file = open_media_file(&path).await?;
    let (file, mime) = match kind {
        MediaKind::Image => (file, mime),
        MediaKind::Mini => {
            drop(file);
            let path = mini_thumb(&name, &path, &base_path).await?;
            (open_media_file(&path).await?, "image/jpeg".to_string())
        }
    };

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(([(header::CONTENT_TYPE, mime)], body))
}

async fn open_media_file(path: &Utf8Path) -> AppResult<File> {
    match File::open(path).await {
        Ok(file) => Ok(file),
        Err(err) if err.kind() == ErrorKind::NotFound => {
            Err(AppError::not_found("media file not found"))
        }
        Err(err) => Err(anyhow::Error::from(err)
            .context(format!("failed to open {path}"))
            .into()),
    }
}

impl Database {
    async fn save_post(
        &self,
        base_path: &Utf8Path,
        post_id: PostId,
        media: &StagedMedia,
        tags: &[Tag],
    ) -> Result<bool> {
        // The immediate transaction serializes the final membership check and
        // publication against an unfavorite arriving from another request.
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;

        if !upload_is_allowed(&mut transaction, post_id).await? {
            return Ok(false);
        }

        if !has_media(&mut transaction, post_id).await? {
            media.publish(base_path).await?;
            insert_media(&mut transaction, post_id, media).await?;
            insert_tags(&mut transaction, post_id, tags).await?;
        }

        transaction.commit().await?;
        Ok(true)
    }

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
            LEFT JOIN favorite_order f ON f.post_id = p.post_id
            WHERE (f.post_id IS NOT NULL OR p.availability = 'deleted')
              AND t.name IN "#,
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

    async fn get_post(&self, post_id: PostId) -> Result<Option<PostMedia>> {
        Ok(sqlx::query_as!(
            PostMedia,
            "SELECT storage_name, mime FROM post_media WHERE post_id = ?",
            post_id.0
        )
        .fetch_optional(&self.pool)
        .await?)
    }
}

async fn upload_is_allowed(connection: &mut SqliteConnection, post_id: PostId) -> Result<bool> {
    Ok(sqlx::query_scalar(
        r#"SELECT EXISTS(
            SELECT 1
            FROM posts p
            LEFT JOIN favorite_order f USING (post_id)
            WHERE post_id = ?
              AND (f.post_id IS NOT NULL OR p.availability = 'deleted')
        )"#,
    )
    .bind(post_id)
    .fetch_one(connection)
    .await?)
}

async fn has_media(connection: &mut SqliteConnection, post_id: PostId) -> Result<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM post_media WHERE post_id = ?)")
            .bind(post_id)
            .fetch_one(connection)
            .await?,
    )
}

async fn insert_media(
    connection: &mut SqliteConnection,
    post_id: PostId,
    media: &StagedMedia,
) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO post_media (
            post_id,
            storage_name,
            extension,
            mime,
            original
        ) VALUES (?, ?, ?, ?, ?)"#,
    )
    .bind(post_id)
    .bind(&media.storage_name)
    .bind(media.extension)
    .bind(media.mime)
    .bind(media.original)
    .execute(connection)
    .await?;

    Ok(())
}

async fn insert_tags(
    connection: &mut SqliteConnection,
    post_id: PostId,
    tags: &[Tag],
) -> Result<()> {
    for tag in tags {
        sqlx::query("INSERT INTO tags (name, kind) VALUES (?, ?) ON CONFLICT DO NOTHING")
            .bind(&tag.name)
            .bind(tag.kind.as_str())
            .execute(&mut *connection)
            .await?;

        let tag_id: TagId = sqlx::query_scalar("SELECT tag_id FROM tags WHERE name = ?")
            .bind(&tag.name)
            .fetch_one(&mut *connection)
            .await?;

        sqlx::query(
            r#"INSERT INTO post_tags (post_id, tag_id)
            VALUES (?, ?)
            ON CONFLICT DO NOTHING"#,
        )
        .bind(post_id)
        .bind(tag_id)
        .execute(&mut *connection)
        .await?;
    }

    Ok(())
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
    pub async fn from_multipart(mut value: Multipart) -> AppResult<Self> {
        let mut image: Option<NamedTempFile> = None;
        let mut tags: Option<Vec<Tag>> = None;

        while let Some(mut field) = value
            .next_field()
            .await
            .map_err(|error| AppError::bad_request(error.body_text()))?
        {
            let name = field.name().unwrap_or("").to_string();

            match name.as_str() {
                "image" => {
                    let mut tmp =
                        NamedTempFile::new().context("Failed to create temp file for image")?;
                    while let Some(chunk) = field
                        .chunk()
                        .await
                        .map_err(|error| AppError::bad_request(error.body_text()))?
                    {
                        tmp.write_all(&chunk).context("Failed writing image data")?;
                    }
                    image = Some(tmp);
                }
                "tags" => {
                    let data = field
                        .text()
                        .await
                        .map_err(|error| AppError::bad_request(error.body_text()))?;
                    let t: Vec<Tag> = serde_json::from_str(&data).map_err(|error| {
                        AppError::bad_request(format!("invalid JSON for tags: {error}"))
                    })?;
                    tags = Some(t);
                }
                _ => {
                    // Ignore unknown fields
                }
            }
        }

        let image = image.ok_or_else(|| AppError::bad_request("missing field: image"))?;
        let tags = tags.unwrap_or_default();

        Ok(PostData { image, tags })
    }
}
