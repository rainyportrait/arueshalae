use askama::Template;
use axum::Router;
use axum::http::{StatusCode, header};
use axum::response::Response;
use axum::{response::IntoResponse, routing::get};
use camino::Utf8Path;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::error;

use crate::database::Database;
use crate::downloader::create_api_server;
use crate::web::create_web_server;

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

pub fn create_router(
    database: &Database,
    base_path: &Utf8Path,
    sender: &mpsc::UnboundedSender<i64>,
) -> Router {
    Router::new()
        .merge(create_web_server(database, base_path))
        .route("/arueshalae.user.js", get(send_userscript))
        .nest("/api", create_api_server(database, sender))
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
