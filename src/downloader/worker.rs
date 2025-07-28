use std::{sync::Arc, time::Duration};

use anyhow::{Result, anyhow, bail};
use camino::{Utf8Path, Utf8PathBuf};
use reqwest::Client;
use serde::Deserialize;
use tempfile::NamedTempFile;
use tokio::{
    fs::File,
    io::AsyncWriteExt,
    sync::{Mutex, mpsc},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;
use tracing::error;

use crate::{database::Database, downloader::image_file::ImageFile};

const HTTP_TIMEOUT: u64 = 60;
const MAX_CONCURRENT_DOWNLOADS: usize = 10;

#[derive(Clone)]
pub struct Downloader {
    database: Database,
    client: Client,
    path: Utf8PathBuf,
    pub sender: mpsc::UnboundedSender<i64>,
    receiver: Arc<Mutex<mpsc::UnboundedReceiver<i64>>>,
    shutdown_token: CancellationToken,
}

impl Downloader {
    pub fn new(database: &Database, path: &Utf8Path, shutdown_token: &CancellationToken) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT))
            .build()
            .expect("create http client");

        let (sender, receiver) = mpsc::unbounded_channel();

        Self {
            database: database.clone(),
            client,
            path: path.to_owned(),
            sender,
            receiver: Arc::new(Mutex::new(receiver)),
            shutdown_token: shutdown_token.clone(),
        }
    }

    pub fn spawn(mut self) -> JoinHandle<()> {
        tokio::spawn(async move {
            if let Err(e) = self.start().await {
                error!("Failed to download: {e}");
            }
        })
    }

    async fn start(&mut self) -> Result<()> {
        // self.queue_pending_posts().await?;
        let handles = (0..MAX_CONCURRENT_DOWNLOADS)
            .map(|_| {
                let worker = self.clone();
                tokio::spawn(async move {
                    worker.worker_loop().await;
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            _ = handle.await;
        }

        Ok(())
    }

    async fn worker_loop(self) {
        loop {
            let post_id = {
                tokio::select! {
                    _ = self.shutdown_token.cancelled() => return,
                    result = async {
                        let mut rx = self.receiver.lock().await;
                        rx.recv().await
                    } => result,
                }
            };

            match post_id {
                Some(post_id) => {
                    if let Err(e) = self.process_post(post_id).await {
                        error!("Failed to download post {post_id}: {e}");
                    }
                }
                None => break,
            };
        }
    }

    async fn process_post(&self, post_id: i64) -> Result<()> {
        let info = self.post_info(post_id).await?;
        let sort_id = self.database.get_internal_post_id(post_id).await?;
        let image = self.download(post_id, sort_id, &info.file_url).await?;
        self.database
            .insert_download(
                post_id,
                &image.file_name(),
                &image.mime(),
                image.is_original(),
            )
            .await?;
        image.commit();
        Ok(())
    }

    async fn post_info(&self, post_id: i64) -> Result<XMLPost> {
        let body = self
            .client
            .get(format!(
                "https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&id={post_id}"
            ))
            .send()
            .await?
            .text()
            .await?;

        quick_xml::de::from_str::<XMLPosts>(body.as_str())?
            .posts
            .into_iter()
            .next()
            .ok_or(anyhow!("API did not return a post"))
    }

    async fn download(&self, post_id: i64, sort_id: i64, url: &str) -> Result<ImageFile> {
        let mime = match mime(url) {
            Some(mime) => mime,
            None => bail!("Couldn't guess mime from file name"),
        };

        let temp_file = NamedTempFile::new()?;

        let mut response = self.client.get(url).send().await?;
        let mut file = File::create(temp_file.path()).await?;
        while let Some(chunk) = response.chunk().await? {
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        drop(file);

        if mime.starts_with("image") {
            Ok(ImageFile::new(self.path.clone(), post_id, sort_id, temp_file).await?)
        } else {
            bail!("videos is todo")
        }
    }

    async fn queue_pending_posts(&self) -> Result<()> {
        let post_ids = self.database.pending_posts().await?;
        for post_id in post_ids {
            self.sender.send(post_id)?;
        }
        Ok(())
    }
}

#[derive(Deserialize, Debug)]
pub struct XMLPosts {
    #[serde(rename = "post")]
    pub posts: Vec<XMLPost>,
}

#[derive(Deserialize, Debug)]
pub struct XMLPost {
    #[serde(rename = "@file_url")]
    pub file_url: String,
    #[serde(rename = "@tags")]
    pub space_seperated_tags: String,
}

fn mime(path: &str) -> Option<String> {
    mime_guess::from_path(path)
        .first()
        .map(|mime| mime.to_string())
}
