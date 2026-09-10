//! IDs name the source entity, never an incidental SQLite row.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct PostId(pub i64);

pub fn parse_id_list(raw: &str) -> Result<Vec<PostId>, String> {
    let mut ids = Vec::new();
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let id = part
            .parse::<i64>()
            .map_err(|_| format!("invalid post ID {part:?}"))?;
        if id <= 0 {
            return Err("post IDs must be positive".to_string());
        }
        ids.push(PostId(id));
    }
    Ok(ids)
}
