use camino::Utf8Path;
use tokio::process::Command;

#[path = "src/database.rs"]
mod database;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let version = env!("CARGO_PKG_VERSION");

    let migrate_db_future = create_dev_database();
    let build_userscript_future = build_userscript(version);
    let build_tailwind_future = build_tailwind();

    tokio::join!(
        migrate_db_future,
        build_userscript_future,
        build_tailwind_future
    );
}

async fn create_dev_database() {
    let path = Utf8Path::new("./dev.db");
    _ = tokio::fs::remove_file(&path).await;
    let _database = database::Database::new(path)
        .await
        .expect("create dev database");
}

async fn build_userscript(version: &str) {
    Command::new("node")
        .arg("build_userscript")
        .arg(version)
        .status()
        .await
        .expect("build userscript");
}

async fn build_tailwind() {
    Command::new("npx")
        .args([
            "@tailwindcss/cli",
            "-i",
            "./assets/styles.css",
            "-o",
            "./target/tailwind/styles.css",
        ])
        .status()
        .await
        .expect("build tailwind stlyes");
}
