use std::time::Duration;

use anyhow::Result;
use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderValue, Method, StatusCode, header},
    response::IntoResponse,
    response::Response,
    routing::{get, post},
};
use camino::{Utf8Path, Utf8PathBuf};
use serde::Deserialize;
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_util::sync::CancellationToken;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::error;

#[cfg(embedded_userscript)]
const USERSCRIPT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/arueshalae.user.js"));

#[cfg(not(embedded_userscript))]
const USERSCRIPT_UNAVAILABLE: &str =
    "The userscript is only provided by the server in release mode.\n";

use crate::{
    database::Database,
    posts::{
        create_post, get_cached_post_details, get_download_count, list_downloaded_posts, search,
        serve_media,
    },
    tags::search_tags,
};

#[macro_export]
macro_rules! json_ok {
    ($($json:tt)+) => {
        Ok(axum::Json(serde_json::json!($($json)+)))
    };
}

#[derive(Clone)]
pub struct AppState {
    pub database: Database,
    pub base_path: Utf8PathBuf,
}

// The `term` query filter shared by the search endpoints.
#[derive(Deserialize)]
pub struct SearchQuery {
    pub term: String,
}

pub fn create_router(database: &Database, base_path: &Utf8Path) -> Router {
    Router::new()
        .route("/arueshalae.user.js", get(serve_userscript))
        .route("/api/sync/status", get(crate::sync::get_status))
        .route("/api/sync/baseline", get(crate::sync::get_baseline))
        .route(
            "/api/sync/reconcile",
            post(crate::sync::reconcile_favorites),
        )
        .route("/api/posts/status", get(crate::sync::get_post_status))
        .route("/api/posts/pending", get(crate::sync::get_pending_posts))
        .route(
            "/api/posts/{post_id}/membership",
            post(crate::sync::set_post_membership),
        )
        .route(
            "/api/posts/{post_id}/observation",
            post(crate::sync::observe_post_details),
        )
        .route(
            "/api/posts/{post_id}/status",
            post(crate::sync::update_post_status),
        )
        .route("/api/posts/{post_id}", post(create_post))
        .layer(DefaultBodyLimit::max(1024 * 1024 * 1024))
        .route("/api/posts/downloaded", get(list_downloaded_posts))
        .route("/api/posts/search", get(search))
        .route("/api/posts/count", get(get_download_count))
        .route("/api/posts/{post_id}/details", get(get_cached_post_details))
        .route("/api/posts/{post_id}/media", get(serve_media))
        .route(
            "/api/prune",
            get(crate::prune::get_prune_preview).post(crate::prune::prune),
        )
        .route("/api/tags", get(search_tags))
        .layer(
            CorsLayer::new()
                .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
                .allow_origin("https://rule34.xxx".parse::<HeaderValue>().unwrap())
                .allow_headers([header::CONTENT_TYPE])
                .max_age(Duration::from_secs(60 * 60 * 2)),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(AppState {
            database: database.clone(),
            base_path: base_path.to_path_buf(),
        })
}

#[cfg(embedded_userscript)]
async fn serve_userscript() -> impl IntoResponse {
    (
        [(
            header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        USERSCRIPT,
    )
}

#[cfg(not(embedded_userscript))]
async fn serve_userscript() -> impl IntoResponse {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        USERSCRIPT_UNAVAILABLE,
    )
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, response::IntoResponse};

    use super::*;

    #[tokio::test]
    async fn userscript_response_matches_build_mode() {
        let response = serve_userscript().await.into_response();

        #[cfg(embedded_userscript)]
        {
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers()[header::CONTENT_TYPE],
                "application/javascript; charset=utf-8"
            );
            assert_eq!(
                to_bytes(response.into_body(), usize::MAX).await.unwrap(),
                USERSCRIPT
            );
        }

        #[cfg(not(embedded_userscript))]
        {
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                response.headers()[header::CONTENT_TYPE],
                "text/plain; charset=utf-8"
            );
            assert_eq!(
                to_bytes(response.into_body(), usize::MAX).await.unwrap(),
                USERSCRIPT_UNAVAILABLE
            );
        }
    }
}

/// Bind the listener, then spawn the serve loop. Binding happens here (rather
/// than inside the task) so a failed bind panics in `main` instead of silently
/// killing the spawned task.
pub async fn spawn_server(
    router: Router,
    address: &str,
    shutdown_token: &CancellationToken,
) -> JoinHandle<()> {
    let shutdown_token = shutdown_token.clone();

    let listener = TcpListener::bind(address)
        .await
        .unwrap_or_else(|err| panic!("failed to bind {address}: {err}"));

    tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, router)
            .with_graceful_shutdown(async move { shutdown_token.cancelled().await })
            .await
        {
            error!("Server error: {err}");
        }
    })
}

#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    NotFound(String),
    Conflict(String),
    Internal(anyhow::Error),
}

impl AppError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::BadRequest(message.into())
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message).into_response(),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message).into_response(),
            Self::Conflict(message) => (StatusCode::CONFLICT, message).into_response(),
            Self::Internal(err) => {
                error!("Request failed: {err:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
        }
    }
}

impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(err: E) -> Self {
        Self::Internal(err.into())
    }
}

pub type AppResult<T> = Result<T, AppError>;
