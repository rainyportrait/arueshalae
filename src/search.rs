use anyhow::Result;
use axum::{
    Json,
    body::Body,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

use crate::{
    database::Database,
    json_ok,
    media_processor::{file_name, mini_thumb},
    server::{AppResult, AppState},
    upload::PostIdsResponse,
};

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
                result.include.push(term);
            }
        }

        result
    }
}

#[derive(Deserialize)]
pub struct SearchQuery {
    term: String,
}
pub async fn search(
    State(AppState { database, .. }): State<AppState>,
    Query(SearchQuery { term }): Query<SearchQuery>,
) -> AppResult<Json<PostIdsResponse>> {
    let search = Search::new(&term);
    let post_ids = database.search(&search).await?;
    Ok(Json(PostIdsResponse { post_ids }))
}

pub async fn autocomplete(
    State(AppState { database, .. }): State<AppState>,
    Query(SearchQuery { term }): Query<SearchQuery>,
) -> AppResult<Json<Value>> {
    json_ok!({"suggestions": database.autocomplete(&term).await?})
}

pub async fn serve_image(
    State(AppState {
        database,
        base_path,
        ..
    }): State<AppState>,
    Path(post_id): Path<i64>,
) -> impl IntoResponse {
    let (path, mime) = match database.get_post(post_id).await {
        Ok(post) => {
            let name = file_name(post.id, post.external_id, &post.extension);
            let path = if post.mime.starts_with("image") {
                base_path.join(name)
            } else {
                base_path.join(".thumbs").join(format!("{name}.jpeg"))
            };
            if !path.is_file() {
                return Err((StatusCode::NOT_FOUND, "file not found on disk"));
            }
            (path, post.mime)
        }
        Err(_) => return Err((StatusCode::NOT_FOUND, "post not found in database")),
    };

    let file = match File::open(&path).await {
        Ok(file) => file,
        Err(_) => return Err((StatusCode::NOT_FOUND, "unable to open file")),
    };

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(([(header::CONTENT_TYPE, mime)], body))
}

pub async fn serve_mini(
    State(AppState {
        database,
        base_path,
        ..
    }): State<AppState>,
    Path(post_id): Path<i64>,
) -> impl IntoResponse {
    let (original_path, name) = match database.get_post(post_id).await {
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
            (path, name)
        }
        Err(_) => return Err((StatusCode::NOT_FOUND, "post not found in database")),
    };

    let path = match mini_thumb(&name, &original_path, &base_path).await {
        Ok(path) => path,
        Err(_) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to create mini thumb",
            ));
        }
    };

    let file = match File::open(&path).await {
        Ok(file) => file,
        Err(_) => return Err((StatusCode::NOT_FOUND, "unable to open file")),
    };

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(([(header::CONTENT_TYPE, "image/jpeg")], body))
}

struct PostData {
    id: i64,
    external_id: i64,
    extension: String,
    mime: String,
}

#[derive(Serialize)]
struct AutoCompleteSuggestion {
    name: String,
    kind: String,
    uses: i64,
}

impl Database {
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

    async fn autocomplete(&self, term: &str) -> Result<Vec<AutoCompleteSuggestion>> {
        let like = format!("%{term}%");
        Ok(sqlx::query_as!(
            AutoCompleteSuggestion,
            r#"SELECT name, kind, uses
            FROM tags_with_uses
            WHERE name LIKE ?
            LIMIT 10"#,
            like
        )
        .fetch_all(&self.pool)
        .await?)
    }

    async fn get_post(&self, external_id: i64) -> Result<PostData> {
        Ok(sqlx::query_as!(
            PostData,
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
