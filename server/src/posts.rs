use std::{io::ErrorKind, io::Write};

use anyhow::{Context, Result};
use axum::{
    Json,
    body::Body,
    extract::{Multipart, Path, Query, Request, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
};
use camino::Utf8Path;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqliteConnection;
use tempfile::{NamedTempFile, TempDir};
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use tower_http::services::ServeFile;
use tracing::info;

use crate::{
    database::Database,
    ids::{PostId, parse_id_list as parse_post_ids},
    json_ok,
    media_processor::{MediaProcessor, MediaProcessorResult, file_name, mini_thumb},
    server::{AppError, AppResult, AppState},
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
    parse_post_ids(&raw)
        .map(Some)
        .map_err(serde::de::Error::custom)
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
    scores: Vec<ScoreFilter>,
    sort: SearchSort,
}

#[derive(Clone, Copy)]
enum Comparison {
    Lt,
    Le,
    Eq,
    Ge,
    Gt,
}
struct ScoreFilter {
    comparison: Comparison,
    value: i64,
}
#[derive(Clone, Copy)]
enum SortField {
    Favorite,
    Id,
    Score,
    Random,
}
#[derive(Clone, Copy)]
struct SearchSort {
    field: SortField,
    ascending: bool,
}

impl<'a> Search<'a> {
    fn new(input: &'a str) -> AppResult<Self> {
        let mut result = Self {
            include: Vec::new(),
            exclude: Vec::new(),
            scores: Vec::new(),
            sort: SearchSort {
                field: SortField::Favorite,
                ascending: true,
            },
        };
        let mut saw_sort = false;

        for term in input.split_whitespace() {
            if let Some(value) = term.strip_prefix("sort:") {
                if saw_sort {
                    return Err(AppError::bad_request("multiple sort operators"));
                }
                saw_sort = true;
                let mut parts = value.split(':');
                result.sort.field = match parts.next() {
                    Some("id") => SortField::Id,
                    Some("score") => SortField::Score,
                    Some("random") => SortField::Random,
                    _ => return Err(AppError::bad_request("sort must be id, score, or random")),
                };
                result.sort.ascending = match parts.next() {
                    None | Some("desc") => false,
                    Some("asc") => true,
                    _ => return Err(AppError::bad_request("sort direction must be asc or desc")),
                };
                if parts.next().is_some() {
                    return Err(AppError::bad_request("invalid sort operator"));
                }
            } else if let Some(value) = term.strip_prefix("score:") {
                let (comparison, number) = if let Some(v) = value.strip_prefix(">=") {
                    (Comparison::Ge, v)
                } else if let Some(v) = value.strip_prefix("<=") {
                    (Comparison::Le, v)
                } else if let Some(v) = value.strip_prefix('>') {
                    (Comparison::Gt, v)
                } else if let Some(v) = value.strip_prefix('<') {
                    (Comparison::Lt, v)
                } else if let Some(v) = value.strip_prefix('=') {
                    (Comparison::Eq, v)
                } else {
                    return Err(AppError::bad_request("invalid score comparison"));
                };
                let value = number
                    .parse()
                    .map_err(|_| AppError::bad_request("score must be an integer"))?;
                result.scores.push(ScoreFilter { comparison, value });
            } else if let Some(t) = term.strip_prefix("-") {
                if !t.is_empty() && !result.exclude.contains(&t) {
                    result.exclude.push(t)
                }
            } else if !result.include.contains(&term) {
                result.include.push(term)
            }
        }

        Ok(result)
    }
}

#[derive(Deserialize)]
pub struct PostSearchQuery {
    term: String,
    #[serde(default)]
    offset: i64,
    #[serde(default = "default_search_limit")]
    limit: i64,
    #[serde(default)]
    seed: i64,
}
fn default_search_limit() -> i64 {
    50
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchPost {
    post_id: PostId,
    downloaded: bool,
    tags: Vec<String>,
}

#[derive(Serialize)]
pub struct SearchResponse {
    posts: Vec<SearchPost>,
    total: i64,
}

pub async fn search(
    State(AppState { database, .. }): State<AppState>,
    Query(query): Query<PostSearchQuery>,
) -> AppResult<Json<SearchResponse>> {
    if query.offset < 0 || !(1..=100).contains(&query.limit) {
        return Err(AppError::bad_request(
            "offset must be non-negative and limit must be 1 through 100",
        ));
    }
    let search = Search::new(&query.term)?;
    Ok(Json(
        database
            .search(&search, query.offset, query.limit, query.seed)
            .await?,
    ))
}

pub async fn get_download_count(
    State(AppState { database, .. }): State<AppState>,
) -> AppResult<Json<Value>> {
    json_ok!({"count": database.get_download_count().await?})
}

pub async fn get_cached_post_details(
    State(AppState { database, .. }): State<AppState>,
    Path(post_id): Path<PostId>,
) -> AppResult<Json<CachedPostDetails>> {
    database
        .cached_post_details(post_id)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::not_found("cached post details not found"))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum MediaKind {
    #[default]
    Image,
    Mini,
    Video,
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
    request: Request,
) -> AppResult<Response> {
    let Some(post) = database.get_post(post_id).await? else {
        return Err(AppError::not_found("post not found"));
    };
    let name = post.storage_name;

    if matches!(kind, MediaKind::Video) {
        let path = base_path.join(name);
        let mut response = ServeFile::new(path)
            .try_call(request)
            .await
            .context("failed to serve video")?;
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&post.mime).context("invalid stored media MIME type")?,
        );
        return Ok(response.into_response());
    }

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
        MediaKind::Video => unreachable!("video requests return before poster processing"),
    };

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(([(header::CONTENT_TYPE, mime)], body).into_response())
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
            replace_tags(&mut transaction, post_id, tags).await?;
        }

        transaction.commit().await?;
        Ok(true)
    }

    // Which of the requested posts the library holds; without a request, the
    // whole library. The ids come back in no particular order.
    async fn downloaded_post_ids(&self, requested: Option<&[PostId]>) -> Result<Vec<PostId>> {
        let Some(requested) = requested else {
            return Ok(sqlx::query_scalar!(
                r#"SELECT post_id AS "post_id: PostId" FROM post_media"#
            )
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

    async fn cached_post_details(&self, post_id: PostId) -> Result<Option<CachedPostDetails>> {
        let Some(post) = sqlx::query_as!(
            CachedPostRow,
            r#"SELECT p.status, p.score, pm.mime
            FROM posts p
            JOIN post_media pm USING (post_id)
            WHERE p.post_id = ?"#,
            post_id.0
        )
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };

        let tags = sqlx::query_as!(
            CachedPostTag,
            r#"SELECT t.name, t.kind
            FROM post_tags pt
            JOIN tags t USING (tag_id)
            WHERE pt.post_id = ?
            ORDER BY t.kind, t.name"#,
            post_id.0
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(Some(CachedPostDetails {
            id: post_id,
            status: post.status,
            score: post.score,
            media_kind: if post.mime.starts_with("video/") {
                CachedMediaKind::Video
            } else {
                CachedMediaKind::Image
            },
            tags,
        }))
    }

    async fn search(
        &self,
        search: &Search<'_>,
        offset: i64,
        limit: i64,
        seed: i64,
    ) -> Result<SearchResponse> {
        let mut query_builder = sqlx::QueryBuilder::new(
            r#"SELECT p.post_id, pm.post_id IS NOT NULL
            FROM posts p
            JOIN favorite_order f ON f.post_id = p.post_id
            LEFT JOIN post_media pm ON pm.post_id = p.post_id
            WHERE p.status = 'favorited'"#,
        );
        for term in &search.include {
            query_builder.push(
                r#" AND EXISTS (
                    SELECT 1
                    FROM post_tags pt
                    JOIN tags t ON t.tag_id = pt.tag_id
                    WHERE pt.post_id = p.post_id AND t.name = "#,
            );
            query_builder.push_bind(term);
            query_builder.push(")");
        }
        for term in &search.exclude {
            query_builder.push(
                r#" AND NOT EXISTS (
                    SELECT 1
                    FROM post_tags pt
                    JOIN tags t ON t.tag_id = pt.tag_id
                    WHERE pt.post_id = p.post_id AND t.name = "#,
            );
            query_builder.push_bind(term);
            query_builder.push(")");
        }
        for filter in &search.scores {
            query_builder.push(" AND p.score ");
            query_builder.push(match filter.comparison {
                Comparison::Lt => "<",
                Comparison::Le => "<=",
                Comparison::Eq => "=",
                Comparison::Ge => ">=",
                Comparison::Gt => ">",
            });
            query_builder.push_bind(filter.value);
        }
        let order = match search.sort.field {
            SortField::Favorite => "f.position",
            SortField::Id => "p.post_id",
            SortField::Score => "p.score",
            SortField::Random => "((((p.post_id | ",
        };
        query_builder.push(" ORDER BY ");
        if matches!(search.sort.field, SortField::Random) {
            query_builder
                .push(order)
                .push_bind(seed)
                .push(") - (p.post_id & ")
                .push_bind(seed)
                .push(")) * 1103515245) & 2147483647)");
        } else {
            query_builder.push(order);
        }
        if matches!(search.sort.field, SortField::Random) || !search.sort.ascending {
            query_builder.push(" DESC");
        } else {
            query_builder.push(" ASC");
        }
        query_builder
            .push(", p.post_id DESC LIMIT ")
            .push_bind(limit)
            .push(" OFFSET ")
            .push_bind(offset);
        let rows: Vec<(i64, bool)> = query_builder.build_query_as().fetch_all(&self.pool).await?;
        let total = self.search_count(search).await?;
        let mut posts = Vec::with_capacity(rows.len());
        for (post_id, downloaded) in rows {
            let tags = sqlx::query_scalar!("SELECT t.name FROM post_tags pt JOIN tags t USING (tag_id) WHERE pt.post_id = ? ORDER BY t.kind, t.name", post_id).fetch_all(&self.pool).await?;
            posts.push(SearchPost {
                post_id: PostId(post_id),
                downloaded,
                tags,
            });
        }
        Ok(SearchResponse { posts, total })
    }

    async fn search_count(&self, search: &Search<'_>) -> Result<i64> {
        let mut qb = sqlx::QueryBuilder::new(
            "SELECT COUNT(*) FROM posts p JOIN favorite_order f ON f.post_id=p.post_id WHERE p.status='favorited'",
        );
        for term in &search.include {
            qb.push(" AND EXISTS (SELECT 1 FROM post_tags pt JOIN tags t USING(tag_id) WHERE pt.post_id=p.post_id AND t.name=").push_bind(term).push(")");
        }
        for term in &search.exclude {
            qb.push(" AND NOT EXISTS (SELECT 1 FROM post_tags pt JOIN tags t USING(tag_id) WHERE pt.post_id=p.post_id AND t.name=").push_bind(term).push(")");
        }
        for filter in &search.scores {
            qb.push(" AND p.score ")
                .push(match filter.comparison {
                    Comparison::Lt => "<",
                    Comparison::Le => "<=",
                    Comparison::Eq => "=",
                    Comparison::Ge => ">=",
                    Comparison::Gt => ">",
                })
                .push_bind(filter.value);
        }
        Ok(qb.build_query_scalar().fetch_one(&self.pool).await?)
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
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS(
            SELECT 1
            FROM posts p
            WHERE post_id = ?
              AND p.status IN ('favorited', 'deleted')
        ) AS "exists!: bool""#,
        post_id.0
    )
    .fetch_one(connection)
    .await?)
}

async fn has_media(connection: &mut SqliteConnection, post_id: PostId) -> Result<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM post_media WHERE post_id = ?) AS "exists!: bool""#,
        post_id.0
    )
    .fetch_one(connection)
    .await?)
}

async fn insert_media(
    connection: &mut SqliteConnection,
    post_id: PostId,
    media: &StagedMedia,
) -> Result<()> {
    sqlx::query!(
        r#"INSERT INTO post_media (
            post_id,
            storage_name,
            extension,
            mime,
            original
        ) VALUES (?, ?, ?, ?, ?)"#,
        post_id.0,
        media.storage_name,
        media.extension,
        media.mime,
        media.original,
    )
    .execute(connection)
    .await?;

    Ok(())
}

pub(crate) async fn replace_tags(
    connection: &mut SqliteConnection,
    post_id: PostId,
    tags: &[Tag],
) -> Result<()> {
    sqlx::query!("DELETE FROM post_tags WHERE post_id = ?", post_id.0)
        .execute(&mut *connection)
        .await?;

    for tag in tags {
        let kind = tag.kind.as_str();
        sqlx::query!(
            "INSERT INTO tags (name, kind) VALUES (?, ?) ON CONFLICT DO NOTHING",
            tag.name,
            kind,
        )
        .execute(&mut *connection)
        .await?;

        sqlx::query!(
            r#"INSERT INTO post_tags (post_id, tag_id)
            VALUES (?, (SELECT tag_id FROM tags WHERE name = ?))
            ON CONFLICT DO NOTHING"#,
            post_id.0,
            tag.name,
        )
        .execute(&mut *connection)
        .await?;
    }

    Ok(())
}

struct PostMedia {
    storage_name: String,
    mime: String,
}

struct CachedPostRow {
    status: String,
    score: i64,
    mime: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedPostDetails {
    id: PostId,
    status: String,
    score: i64,
    media_kind: CachedMediaKind,
    tags: Vec<CachedPostTag>,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum CachedMediaKind {
    Image,
    Video,
}

#[derive(Serialize)]
struct CachedPostTag {
    name: String,
    kind: String,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    pub kind: TagKind,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
    use camino::Utf8Path;
    use tempfile::tempdir;

    use super::*;

    async fn test_database() -> (tempfile::TempDir, Database) {
        let directory = tempdir().unwrap();
        let path = Utf8Path::from_path(directory.path())
            .unwrap()
            .join("test.db");
        let database = Database::new(&path).await.unwrap();

        (directory, database)
    }

    async fn seed_search_posts(database: &Database) {
        sqlx::query(
            r#"INSERT INTO posts (post_id, status) VALUES
                (1, 'favorited'), (2, 'favorited'), (3, 'favorited'),
                (4, 'favorited'), (5, 'favorited');
            INSERT INTO post_media (post_id, storage_name, extension, mime, original) VALUES
                (1, '1.png', 'png', 'image/png', 1),
                (2, '2.png', 'png', 'image/png', 1),
                (3, '3.png', 'png', 'image/png', 1),
                (5, '5.png', 'png', 'image/png', 1);
            INSERT INTO favorite_order (position, post_id) VALUES
                (0, 1), (1, 2), (2, 3), (3, 4), (4, 5);
            INSERT INTO tags (tag_id, name, kind) VALUES
                (1, 'cat', 'general'), (2, 'dog', 'general');
            INSERT INTO post_tags (post_id, tag_id) VALUES
                (1, 1), (1, 2), (2, 1), (3, 2), (4, 1)"#,
        )
        .execute(&database.pool)
        .await
        .unwrap();
    }

    async fn search_ids(database: &Database, term: &str) -> Vec<PostId> {
        search_ids_with_seed(database, term, 0).await
    }

    async fn search_ids_with_seed(database: &Database, term: &str, seed: i64) -> Vec<PostId> {
        database
            .search(&Search::new(term).unwrap(), 0, 50, seed)
            .await
            .unwrap()
            .posts
            .into_iter()
            .map(|post| post.post_id)
            .collect()
    }

    #[tokio::test]
    async fn search_honors_exclusions_and_empty_queries() {
        let (_directory, database) = test_database().await;
        seed_search_posts(&database).await;

        assert_eq!(
            search_ids(&database, "cat -dog").await,
            vec![PostId(2), PostId(4)]
        );
        assert_eq!(
            search_ids(&database, "cat cat").await,
            vec![PostId(1), PostId(2), PostId(4)]
        );
        assert_eq!(
            search_ids(&database, "-dog").await,
            vec![PostId(2), PostId(4), PostId(5)]
        );
        assert_eq!(
            search_ids(&database, "").await,
            vec![PostId(1), PostId(2), PostId(3), PostId(4), PostId(5)]
        );
    }

    #[tokio::test]
    async fn search_honors_score_filters_and_sorting() {
        let (_directory, database) = test_database().await;
        seed_search_posts(&database).await;
        sqlx::query("UPDATE posts SET score = post_id * 10")
            .execute(&database.pool)
            .await
            .unwrap();

        assert_eq!(
            search_ids(&database, "score:>=20 score:<50 sort:score").await,
            vec![PostId(4), PostId(3), PostId(2)]
        );
        assert_eq!(
            search_ids(&database, "score:>=20 score:<50 sort:id:asc").await,
            vec![PostId(2), PostId(3), PostId(4)]
        );
    }

    #[test]
    fn search_rejects_invalid_operators() {
        for query in [
            "sort:date",
            "sort:id:sideways",
            "sort:id sort:score",
            "score:10",
            "score:>=nope",
        ] {
            assert!(Search::new(query).is_err(), "accepted {query}");
        }
    }

    #[tokio::test]
    async fn random_sort_is_seeded_and_ignores_direction() {
        let (_directory, database) = test_database().await;
        seed_search_posts(&database).await;

        let first = search_ids_with_seed(&database, "sort:random", 1234).await;
        assert_eq!(
            first,
            search_ids_with_seed(&database, "sort:random:asc", 1234).await
        );
        assert_ne!(
            first,
            search_ids_with_seed(&database, "sort:random", 987654).await
        );
    }

    #[tokio::test]
    async fn cached_details_include_downloaded_media_tags_and_score() {
        let (_directory, database) = test_database().await;
        sqlx::query(
            r#"INSERT INTO posts (post_id, status, score)
                VALUES (7, 'deleted', -12), (8, 'favorited', 4);
            INSERT INTO post_media (post_id, storage_name, extension, mime, original)
                VALUES (7, '7.webm', 'webm', 'video/webm', 1);
            INSERT INTO tags (tag_id, name, kind)
                VALUES (1, 'animated', 'metadata'), (2, 'hero', 'character');
            INSERT INTO post_tags (post_id, tag_id)
                VALUES (7, 1), (7, 2), (8, 2)"#,
        )
        .execute(&database.pool)
        .await
        .unwrap();

        let details = database
            .cached_post_details(PostId(7))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(details).unwrap(),
            serde_json::json!({
                "id": 7,
                "status": "deleted",
                "score": -12,
                "mediaKind": "video",
                "tags": [
                    {"name": "hero", "kind": "character"},
                    {"name": "animated", "kind": "metadata"}
                ]
            })
        );
        assert!(
            database
                .cached_post_details(PostId(8))
                .await
                .unwrap()
                .is_none()
        );
    }
}
