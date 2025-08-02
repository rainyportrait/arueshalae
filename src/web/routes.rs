use askama::Template;
use axum::{
    Router,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, header},
    response::IntoResponse,
    routing::get,
};
use camino::{Utf8Path, Utf8PathBuf};
use reqwest::StatusCode;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

use crate::{database::Database, html_ok, server::AppResult, web::models::Post};

use super::database::{POSTS_PER_PAGE, PageQuery};

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
        .route("/htmx.js", get(send_htmx))
        .with_state(state)
}

async fn index(
    State(WebState { database, .. }): State<WebState>,
    Query(query): Query<PageQuery>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let (posts, total_post_count) = database.get_page(&query).await?;

    #[derive(Template)]
    #[template(path = "index.html")]
    struct PostList {
        posts: Vec<Post>,
        current_page: i64,
        pagination: Pagination,
    }

    #[derive(Template)]
    #[template(path = "index.html", block = "content")]
    struct PostListPartial {
        posts: Vec<Post>,
        current_page: i64,
        pagination: Pagination,
    }

    let pagination = pagination(5, query.page.unwrap_or(1), total_post_count);
    match headers.contains_key("HX-Request") {
        false => html_ok!(PostList {
            posts,
            current_page: query.page.unwrap_or(0),
            pagination,
        }),
        true => html_ok!(PostListPartial {
            posts,
            current_page: query.page.unwrap_or(0),
            pagination,
        }),
    }
}

struct Pagination {
    pages: Vec<i64>,
    show_first: bool,
    show_last: bool,
    total_page_count: i64,
}
fn pagination(button_count: i64, current_page: i64, total_post_count: u64) -> Pagination {
    let total_page_count: i64 = total_post_count.div_ceil(POSTS_PER_PAGE as u64) as i64;
    if total_page_count == 0 {
        return Pagination {
            pages: Vec::new(),
            show_first: false,
            show_last: false,
            total_page_count: 0,
        };
    }
    let current_page = current_page.clamp(1, total_page_count);
    let button_count = button_count.max(1);
    let offset = (button_count - 1) / 2;

    let desired_start = current_page.saturating_sub(offset).max(1);
    let desired_end = desired_start + button_count - 1;

    let start = if desired_end > total_page_count {
        total_page_count.saturating_sub(button_count - 1).max(1)
    } else {
        desired_start
    };

    let end = (start + button_count - 1).min(total_page_count);

    Pagination {
        pages: (start..=end).collect(),
        show_first: start > 1,
        show_last: end < total_page_count,
        total_page_count,
    }
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
        include_str!("../../target/tailwind/styles.css"),
    )
}

async fn send_htmx() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript")],
        include_str!("../../assets/htmx.js"),
    )
}
