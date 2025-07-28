mod database;
mod downloader;
mod server;

use camino::Utf8PathBuf;
use clap::Parser;
use tokio::signal;
use tokio_util::sync::CancellationToken;

use crate::{
    database::Database,
    downloader::Downloader,
    server::{create_router, spawn_server},
};

#[derive(clap::Parser)]
#[command(
    name = "arueshalae",
    about = "Downloads your rule34.xxx favorites",
    version
)]
struct Args {
    #[arg(default_value = "./r34", index = 1)]
    path: Utf8PathBuf,
}

fn path_from_args() -> Utf8PathBuf {
    let args = Args::parse();
    let path = args.path;

    std::fs::create_dir_all(&path).expect("create base directory");

    if path.is_file() {
        panic!("{path} is not a directory");
    }

    path
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let path = path_from_args();

    let shutdown_signal = shutdown_signal();
    let shutdown_token = CancellationToken::new();

    let database = Database::new(&path.join(".data.db"))
        .await
        .expect("open database");

    let downloader = Downloader::new(&database, &path, &shutdown_token);
    let router = create_router(&database, &downloader.sender);

    let server_handle = spawn_server(router, &shutdown_token);
    let downloader_handle = downloader.spawn();

    shutdown_signal.await;
    shutdown_token.cancel();
    _ = tokio::join!(server_handle, downloader_handle);
    database.pool.close().await;
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("install Ctrl+c handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
