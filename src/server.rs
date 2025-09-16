use std::time::Duration;

use anyhow::Result;
use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderValue, Method, StatusCode, header},
    response::IntoResponse,
    response::Response,
    routing::get,
    routing::post,
};
use camino::{Utf8Path, Utf8PathBuf};
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_util::sync::CancellationToken;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::error;

use crate::{
    database::Database,
    search::{autocomplete, search, serve_image, serve_mini},
    upload::{check_download_status, get_download_count, upload},
};

#[macro_export]
macro_rules! json_ok {
    ($($json:tt)+) => {
        Ok(axum::Json(serde_json::json!($($json)+)))
    };
}

#[macro_export]
macro_rules! html_ok {
    ($html:expr) => {
        Ok(axum::response::Html($html.render()?))
    };
}

#[derive(Clone)]
pub struct AppState {
    pub database: Database,
    pub base_path: Utf8PathBuf,
}

pub fn create_router(database: &Database, base_path: &Utf8Path) -> Router {
    Router::new()
        .route("/upload", post(upload))
        .layer(DefaultBodyLimit::max(1024 * 1024 * 1024))
        .route("/check", post(check_download_status))
        .route("/count", get(get_download_count))
        .route("/search", get(search))
        .route("/search/autocomplete", get(autocomplete))
        .route("/image/{post_id}", get(serve_image))
        .route("/image/mini/{post_id}", get(serve_mini))
        .route("/arueshalae.user.js", get(send_userscript))
        .layer(
            CorsLayer::new()
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
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

pub fn spawn_server(router: Router, shutdown_token: &CancellationToken) -> JoinHandle<()> {
    let shutdown_token = shutdown_token.clone();

    tokio::spawn(async move {
        let listener = TcpListener::bind("localhost:34343")
            .await
            .expect("bind to tcp");

        if let Err(err) = axum::serve(listener, router)
            .with_graceful_shutdown(async move { shutdown_token.cancelled().await })
            .await
        {
            error!("Server error: {err}");
        }
    })
}

async fn send_userscript() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript")],
        include_str!("../target/userscript/arueshalae.user.js"),
    )
}

pub struct AppError(anyhow::Error);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Something went wrong: {}", self.0),
        )
            .into_response()
    }
}

impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

pub type AppResult<T> = Result<T, AppError>;
