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
            ORDER BY uses DESC, name
            LIMIT 10"#,
            like
        )
        .fetch_all(&self.pool)
        .await?)
    }
}

#[cfg(test)]
mod tests {
    use camino::Utf8Path;
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn autocomplete_prefers_popular_tags_then_names() {
        let directory = tempdir().unwrap();
        let path = Utf8Path::from_path(directory.path())
            .unwrap()
            .join("test.db");
        let database = Database::new(&path).await.unwrap();

        sqlx::query(
            r#"INSERT INTO posts (post_id) VALUES (1), (2), (3), (4);
            INSERT INTO tags (tag_id, name, kind) VALUES
                (1, 'amber', 'general'),
                (2, 'alpine', 'general'),
                (3, 'alpha', 'general');
            INSERT INTO post_tags (post_id, tag_id) VALUES
                (1, 3), (2, 3), (3, 2), (4, 1)"#,
        )
        .execute(&database.pool)
        .await
        .unwrap();

        let names = database
            .autocomplete("a")
            .await
            .unwrap()
            .into_iter()
            .map(|tag| tag.name)
            .collect::<Vec<_>>();
        assert_eq!(names, ["alpha", "alpine", "amber"]);
    }
}
