use anyhow::Result;
use axum::{
    Json,
    extract::{Query, State},
};
use serde::Serialize;
use serde_json::Value;

use crate::{
    database::Database,
    json_ok,
    server::{AppResult, AppState, SearchQuery},
};

pub async fn search_tags(
    State(AppState { database, .. }): State<AppState>,
    Query(SearchQuery { term }): Query<SearchQuery>,
) -> AppResult<Json<Value>> {
    json_ok!({"tags": database.autocomplete(&term).await?})
}

#[derive(Serialize)]
struct AutoCompleteSuggestion {
    name: String,
    kind: String,
    uses: i64,
}

impl Database {
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
}
