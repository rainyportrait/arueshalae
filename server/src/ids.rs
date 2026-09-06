//! IDs name the source entity, never an incidental SQLite row.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct PostId(pub i64);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct Rule34UserId(pub i64);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct SyncRunId(pub i64);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct TagId(pub i64);
