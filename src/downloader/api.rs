use std::time::Duration;

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, Method, header},
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;
use tokio::sync::mpsc;
use tower_http::cors::CorsLayer;

use crate::{database::Database, json_ok, server::AppResult};

#[derive(Clone)]
struct ApiState {
    database: Database,
    sender: mpsc::UnboundedSender<i64>,
}

pub fn create_api_server(database: &Database, sender: &mpsc::UnboundedSender<i64>) -> Router {
    let sender = sender.clone();

    let state = ApiState {
        database: database.clone(),
        sender,
    };

    Router::new()
        .route("/", get(hello))
        .route("/post", get(post_count).post(receive_posts))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_origin("https://rule34.xxx".parse::<HeaderValue>().unwrap())
                .allow_headers([header::CONTENT_TYPE])
                .max_age(Duration::from_secs(60 * 60 * 2)),
        )
}

async fn hello() -> AppResult<impl IntoResponse> {
    json_ok!({"message": "Hello :)"})
}

#[derive(Deserialize)]
struct ReceivePostsRequest {
    #[serde(rename = "postIds")]
    post_ids: Vec<i64>,
}
async fn receive_posts(
    State(ApiState {
        database, sender, ..
    }): State<ApiState>,
    Json(ReceivePostsRequest { post_ids }): Json<ReceivePostsRequest>,
) -> AppResult<impl IntoResponse> {
    let new_post_ids = database.insert_posts(&post_ids).await?;
    for post_id in new_post_ids {
        _ = sender.send(post_id);
    }
    json_ok!({"success": true})
}

async fn post_count(
    State(ApiState { database, .. }): State<ApiState>,
) -> AppResult<impl IntoResponse> {
    json_ok!({"count": database.post_count().await? })
}
