mod media_processor;
mod server;
mod upload;
mod database;


use camino::Utf8PathBuf;
use clap::Parser;
use tokio::signal;
use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::{
    database::Database,
    server::{create_router, spawn_server},
};

#[derive(clap::Parser)]
#[command(
    name = "arueshalae",
    about = "Downloads your rule34.xxx favorites",
    version
)]
struct Args {
    #[arg(default_value = "./rule34", index = 1)]
    path: Utf8PathBuf,

    #[arg(default_value_t = false, long)]
    verbose: bool,
}

fn args() -> (Utf8PathBuf, bool) {
    let args = Args::parse();
    let path = args.path;

    std::fs::create_dir_all(path.join(".thumbs")).expect("create base directory");

    if path.is_file() {
        panic!("{path} is not a directory");
    }

    (path, args.verbose)
}

#[tokio::main]
async fn main() {
    let (path, verbose) = args();
    let logging_level = if verbose {
        tracing::Level::DEBUG
    } else {
        tracing::Level::INFO
    };

    tracing_subscriber::fmt::fmt()
        .with_max_level(logging_level)
        .init();

    let shutdown_signal = shutdown_signal();
    let shutdown_token = CancellationToken::new();

    let database = Database::new(&path.join(".data.db"))
        .await
        .expect("open database");

    let router = create_router(&database, &path);
    let server_handle = spawn_server(router, &shutdown_token);

    info!("Arueshalae server started");
    info!("The userscript can be installed from http://localhost:34343/arueshalae.user.js");
    info!(
        "Your favorites can be viewed access by clicking on 'My Favorites' from this url: https://rule34.xxx/index.php?page=account&s=home"
    );

    shutdown_signal.await;
    shutdown_token.cancel();
    _ = server_handle.await;
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
