use std::{io::BufReader, path::Path};

use anyhow::{Context, Result, anyhow};
use camino::Utf8PathBuf;
use image::{ImageReader, codecs::jpeg::JpegEncoder};
use tempfile::NamedTempFile;
use tokio::{
    fs::{File, metadata, remove_file, rename},
    io::{AsyncReadExt, AsyncWriteExt},
};
use tracing::info;

const JPEG_QUALITY: u8 = 90;
const COMPRESSION_THRESHOLD: u64 = 3 * 1024 * 1024;

pub struct ImageFile {
    dir_path: Utf8PathBuf,
    post_id: i64,
    sort_id: i64,
    extension: Option<&'static str>,
    mime: Option<&'static str>,
    original: bool,
    should_cleanup: bool,
}
impl ImageFile {
    pub async fn new(
        dir_path: Utf8PathBuf,
        post_id: i64,
        sort_id: i64,
        temp_file: NamedTempFile,
    ) -> Result<Self> {
        let mut image = Self {
            dir_path,
            post_id,
            sort_id,
            original: true,
            extension: None,
            mime: None,
            should_cleanup: true,
        };

        let (mime, extension) = image_info(temp_file.path()).await?;
        let file_size = metadata(temp_file.path()).await?.len();
        if file_size < COMPRESSION_THRESHOLD {
            image.extension = Some(extension);
            image.mime = Some(mime);
            image.move_image(temp_file).await?;
        } else {
            image.compress_and_save(temp_file).await?;
        }

        Ok(image)
    }

    async fn compress_and_save(&mut self, temp_file: NamedTempFile) -> Result<()> {
        self.extension = Some("jpeg");
        self.mime = Some("image/jpeg");
        self.original = false;
        info!("Compressing file {}", self.file_name());

        let temp_path = temp_file.path().to_owned();
        let final_path = self.image_path();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let temp_file = std::fs::File::open(&temp_path)?;
            let file_reader = BufReader::new(temp_file);
            let image = ImageReader::new(file_reader)
                .with_guessed_format()?
                .decode()?;
            let file = std::fs::File::create(final_path)?;
            JpegEncoder::new_with_quality(&file, JPEG_QUALITY)
                .encode_image(&image)
                .context("during encoding")?;
            file.sync_all()?;
            Ok(())
        })
        .await?
    }

    async fn move_image(&self, temp_file: NamedTempFile) -> Result<()> {
        let final_path = self.image_path();
        if let Err(_) = rename(temp_file.path(), &final_path).await {
            let mut temp_file = File::open(temp_file.path()).await?;
            let mut final_file = File::create(&final_path).await?;

            tokio::io::copy(&mut temp_file, &mut final_file).await?;
            final_file.flush().await?;
        }

        Ok(())
    }

    fn image_path(&self) -> Utf8PathBuf {
        self.dir_path.join(self.file_name())
    }

    pub fn is_original(&self) -> bool {
        self.original
    }

    pub fn file_name(&self) -> String {
        format!(
            "{:07}_{}.{}",
            self.sort_id,
            self.post_id,
            self.extension
                .expect("called ImageFile::file_name() without setting extension")
        )
    }

    pub fn commit(mut self) {
        self.should_cleanup = false;
    }

    pub fn mime(&self) -> &'static str {
        self.mime
            .expect("called ImageFile::mime() without setting mime")
    }

    fn cleanup(&mut self) {
        if self.should_cleanup {
            let path = self.image_path();
            tokio::spawn(async move {
                let _ = remove_file(path).await;
            });
            self.should_cleanup = false;
        }
    }
}

impl Drop for ImageFile {
    fn drop(&mut self) {
        self.cleanup();
    }
}

async fn image_info(path: &Path) -> Result<(&'static str, &'static str)> {
    let mut file = File::open(path).await?;
    let mut bytes = [0; 64];
    file.read_exact(&mut bytes).await?;

    let format = image::guess_format(&bytes)?;
    Ok((
        format.to_mime_type(),
        format
            .extensions_str()
            .first()
            .map(|ext| *ext)
            .ok_or(anyhow!("image format has not extension association"))?,
    ))
}
