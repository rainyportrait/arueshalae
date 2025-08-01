use askama::Template;
use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::header,
    response::IntoResponse,
    routing::get,
};
use camino::{Utf8Path, Utf8PathBuf};
use reqwest::StatusCode;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

use crate::{database::Database, html_ok, server::AppResult, web::models::Post};

#[derive(Clone)]
struct WebState {
    database: Database,
    base_path: Utf8PathBuf,
}

pub fn create_web_server(database: &Database, base_path: &Utf8Path) -> Router {
    let state = WebState {
        database: database.clone(),
        base_path: base_path.to_owned(),
    };

    Router::new()
        .route("/", get(index))
        .route("/image/{post_id}", get(send_image))
        .route("/styles.css", get(send_stylesheet))
        .with_state(state)
}

async fn index(State(WebState { database, .. }): State<WebState>) -> AppResult<impl IntoResponse> {
    #[derive(Template)]
    #[template(path = "index.html")]
    struct IndexTemplate {
        posts: Vec<Post>,
    }

    html_ok!(IndexTemplate {
        posts: database.get_page(50, 0).await?
    })
}

async fn send_image(
    State(WebState {
        database,
        base_path,
        ..
    }): State<WebState>,
    Path(post_id): Path<i64>,
) -> impl IntoResponse {
    let (post, path) = if let Ok(post) = database.get_post_for_send_image(post_id).await {
        let path = post.image_path(&base_path);
        if !path.is_file() {
            return Err((StatusCode::NOT_FOUND, "file not found"));
        }
        (post, path)
    } else {
        return Err((StatusCode::NOT_FOUND, "file not found"));
    };

    let file = match File::open(&path).await {
        Ok(file) => file,
        Err(_) => return Err((StatusCode::NOT_FOUND, "file not found")),
    };

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(([(header::CONTENT_TYPE, post.mime)], body))
}

// async fn tag_suggestions(State(WebState { database, .. }): State<WebState>, Query()) -> impl IntoResponse {}

async fn send_stylesheet() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/css")],
        include_str!("./style.css"),
    )
}
