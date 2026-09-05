use anyhow::{Context, Result};
use camino::Utf8Path;

#[path = "src/database.rs"]
mod database;

/// Create a scratch database with the schema applied so sqlx's compile-time
/// query macros can check SQL against the real schema. The connection url is
/// injected into the compilation of the main crate via `cargo:rustc-env`.
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/migrations");

    let path = Utf8Path::new("./dev.db");
    let _ = tokio::fs::remove_file(path).await;

    let _database = database::Database::new(path)
        .await
        .context("failed to create scratch database for sqlx macro checking")?;

    let url = format!(
        "sqlite://{}",
        std::env::current_dir()?.join("dev.db").display()
    );
    println!("cargo:rustc-env=DATABASE_URL={url}");

    Ok(())
}
