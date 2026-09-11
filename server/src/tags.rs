use anyhow::Result;
use axum::{
    Json,
    extract::{Query, State},
};
use serde::Serialize;

use crate::{
    database::Database,
    server::{AppResult, AppState, SearchQuery},
};

pub async fn search_tags(
    State(AppState { database, .. }): State<AppState>,
    Query(SearchQuery { term }): Query<SearchQuery>,
) -> AppResult<Json<Vec<AutoCompleteSuggestion>>> {
    Ok(Json(database.autocomplete(&term).await?))
}

#[derive(Serialize)]
pub struct AutoCompleteSuggestion {
    label: String,
    value: String,
    #[serde(rename = "type")]
    kind: String,
}

impl Database {
    async fn autocomplete(&self, term: &str) -> Result<Vec<AutoCompleteSuggestion>> {
        let like = format!("%{term}%");
        Ok(sqlx::query_as!(
            AutoCompleteSuggestion,
            r#"SELECT t.name || ' (' || COUNT(*) || ')' AS "label!",
                      t.name AS value, t.kind
            FROM tags t
            JOIN post_tags pt USING (tag_id)
            JOIN favorite_order f USING (post_id)
            JOIN posts p USING (post_id)
            WHERE t.name LIKE ? AND p.status = 'favorited'
            GROUP BY t.tag_id
            ORDER BY COUNT(*) DESC, t.name
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
            r#"INSERT INTO posts (post_id, status) VALUES
                (1, 'favorited'), (2, 'favorited'), (3, 'favorited'), (4, 'favorited');
            INSERT INTO favorite_order (position, post_id) VALUES
                (0, 1), (1, 2), (2, 3), (3, 4);
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
            .map(|tag| tag.value)
            .collect::<Vec<_>>();
        assert_eq!(names, ["alpha", "alpine", "amber"]);
    }
}
