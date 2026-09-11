use std::{env, process::Command};

use anyhow::{Context, Result, bail};
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
    println!("cargo::rustc-check-cfg=cfg(embedded_userscript)");

    if env::var("PROFILE").as_deref() == Ok("release") {
        build_userscript()?;
        println!("cargo::rustc-cfg=embedded_userscript");
    }

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

fn build_userscript() -> Result<()> {
    println!("cargo:rerun-if-changed=../userscript/build-userscript.ts");
    println!("cargo:rerun-if-changed=../userscript/package.json");
    println!("cargo:rerun-if-changed=../userscript/pnpm-lock.yaml");
    println!("cargo:rerun-if-changed=../userscript/src");

    let version = env::var("CARGO_PKG_VERSION")?;
    let status = Command::new("node")
        .args(["build-userscript.ts", &version])
        .current_dir("../userscript")
        .status()
        .context("failed to start userscript build")?;

    if !status.success() {
        bail!("userscript build failed with {status}");
    }

    let output = Utf8Path::new(&env::var("OUT_DIR")?).join("arueshalae.user.js");
    std::fs::copy(
        "../userscript/target/userscript/arueshalae.user.js",
        &output,
    )
    .context("failed to copy userscript into Cargo output directory")?;

    Ok(())
}
