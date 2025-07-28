use std::str::FromStr;

use anyhow::Result;
use camino::Utf8Path;
use sqlx::{SqlitePool, sqlite::SqliteConnectOptions};

const MIGRATIONS: [&'static str; 1] = [include_str!("./migrations/202507262345-init.sql")];

#[derive(Clone)]
pub struct Database {
    pub pool: SqlitePool,
}

impl Database {
    pub async fn new(database_path: &Utf8Path) -> Result<Self> {
        let database_url = format!("sqlite://{database_path}");
        let options =
            SqliteConnectOptions::from_str(database_url.as_str())?.create_if_missing(true);
        let pool = SqlitePool::connect_with(options).await?;

        let db = Database { pool };

        db.run_migrations().await?;

        Ok(db)
    }

    async fn run_migrations(&self) -> Result<()> {
        let current_version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&self.pool)
            .await?;

        for (index, migration) in MIGRATIONS.iter().enumerate().skip(current_version as usize) {
            let version = index + 1;
            let mut transaction = self.pool.begin().await?;

            sqlx::query(migration).execute(&mut *transaction).await?;

            sqlx::query(format!("PRAGMA user_version = {version}").as_str())
                .execute(&mut *transaction)
                .await?;

            transaction.commit().await?;
        }

        Ok(())
    }
}
