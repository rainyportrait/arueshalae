use anyhow::{Context, Result, bail};
use camino::Utf8Path;
use tokio::process::Command;

#[path = "src/database.rs"]
mod database;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let version = env!("CARGO_PKG_VERSION");
    install_npm_dependencies().await?;

    let migrate_db_future = create_dev_database();
    let build_userscript_future = build_userscript(version);
    let build_tailwind_future = build_tailwind();

    tokio::try_join!(
        migrate_db_future,
        build_userscript_future,
        build_tailwind_future
    )?;

    Ok(())
}

async fn create_dev_database() -> Result<()> {
    let path = Utf8Path::new("./dev.db");
    tokio::fs::remove_file(&path).await?;
    let _database = database::Database::new(path)
        .await
        .context("failed to migrate database for sqlx macro checking")?;
    Ok(())
}

async fn install_npm_dependencies() -> Result<()> {
    let status = Command::new("npm")
        .arg("install")
        .status()
        .await
        .context("failed to start npm install command")?;
    if !status.success() {
        bail!("npm install failed")
    }
    Ok(())
}

async fn build_userscript(version: &str) -> Result<()> {
    let status = Command::new("node")
        .arg("build_userscript")
        .arg(version)
        .status()
        .await
        .context("could not start node to build userscript")?;
    if !status.success() {
        bail!("failed to build userscript")
    }
    Ok(())
}

async fn build_tailwind() -> Result<()> {
    let status = Command::new("npx")
        .args([
            "@tailwindcss/cli",
            "-i",
            "./assets/styles.css",
            "-o",
            "./target/tailwind/styles.css",
        ])
        .status()
        .await
        .context("failed to start tailwind cli to build tailwind stlyes")?;
    if !status.success() {
        bail!("failed to build tailwind")
    }
    Ok(())
}
