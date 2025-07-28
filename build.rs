use camino::Utf8Path;

#[path = "src/database.rs"]
mod database;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let migrate_db_future = create_dev_database();
    tokio::join!(migrate_db_future);
}

async fn create_dev_database() {
    let path = Utf8Path::new("./dev.db");
    _ = tokio::fs::remove_file(&path).await;
    let _database = database::Database::new(&path)
        .await
        .expect("create dev database");
}
