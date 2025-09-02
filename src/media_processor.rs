use std::{path::Path, process::Stdio};

use anyhow::{Context, Result, anyhow, bail};
use camino::Utf8Path;
use infer::MatcherType;
use tempfile::NamedTempFile;
use tokio::{
    fs::{File, metadata},
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

const HEADER_SIZE: usize = 0xFF;
const JPEG_QUALITY: u8 = 90;
const COMPRESSION_THRESHOLD: u64 = 3 * 1024 * 1024;
const COMPRESSION_BLACKLIST: &[&str] = &["jpeg", "gif"];

pub struct MediaProcessorResult {
    pub file: NamedTempFile,
    pub thumb: Option<NamedTempFile>,
    pub mime: &'static str,
    pub extension: &'static str,
    pub original: bool,
}

impl MediaProcessorResult {
    pub async fn commit(self, base_path: &Utf8Path, id: i64, external_id: i64) -> Result<()> {
        let file_name = format!("{id:07}_{external_id}.{}", self.extension);

        let Self { file, thumb, .. } = self;
        move_file(file.path(), base_path.join(&file_name).as_path()).await?;

        if let Some(thumb) = thumb {
            move_file(
                thumb.path(),
                base_path
                    .join(".thumbs")
                    .join(format!("{file_name}.jpeg"))
                    .as_path(),
            )
            .await?;
        }

        Ok(())
    }
}

pub struct MediaProcessor {
    file: NamedTempFile,
}

impl MediaProcessor {
    pub async fn process(file: NamedTempFile) -> Result<MediaProcessorResult> {
        let processor = Self { file };
        let file_type = processor
            .file_type()
            .await
            .context("failed to determine file type")?;

        Ok(match file_type.matcher_type() {
            MatcherType::Video => processor.process_video(file_type).await?,
            MatcherType::Image => processor.process_image(file_type).await?,
            matched_type => bail!("Unsupported file type: {:#?}", matched_type),
        })
    }

    async fn process_video(mut self, file_type: infer::Type) -> Result<MediaProcessorResult> {
        let thumb_file = self.make_video_thumbnail().await?;

        Ok(MediaProcessorResult {
            file: self.file,
            thumb: Some(thumb_file),
            mime: file_type.mime_type(),
            extension: file_type.extension(),
            original: true,
        })
    }

    async fn make_video_thumbnail(&mut self) -> Result<NamedTempFile> {
        let thumb_file = NamedTempFile::with_suffix(".jpeg")?;
        let thumb_path = thumb_file.path();
        let thumb_time = self.video_duration().await? * 0.1;
        if !Command::new("ffmpeg")
            .arg("-y")
            .arg("-ss")
            .arg(thumb_time.to_string())
            .arg("-i")
            .arg(self.file.path())
            .arg("-frames:v")
            .arg("1")
            .arg("-q:v")
            .arg("2")
            .arg("-update")
            .arg("1")
            .arg(thumb_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .status()
            .await
            .context("failed to start ffmpeg. is it installed?")?
            .success()
        {
            bail!(
                "ffmpeg failed to create thumbnail for {:?} -> {:?}",
                self.file.path(),
                thumb_path
            )
        };
        Ok(thumb_file)
    }

    async fn video_duration(&self) -> Result<f32> {
        let output = Command::new("ffprobe")
            .arg("-v")
            .arg("quiet")
            .arg("-i")
            .arg(self.file.path())
            .arg("-show_entries")
            .arg("format=duration")
            .arg("-of")
            .arg("csv=p=0")
            .stdin(Stdio::null())
            .output()
            .await
            .context("failed to start ffmpeg. is it installed?")?;

        if !output.status.success() {
            bail!("ffprobe failed to get length");
        }

        Ok(String::from_utf8(output.stdout)?
            .lines()
            .next()
            .ok_or(anyhow!("ffprobe did not return video duration"))?
            .parse()?)
    }

    async fn process_image(self, file_type: infer::Type) -> Result<MediaProcessorResult> {
        if !COMPRESSION_BLACKLIST.contains(&file_type.extension())
            && metadata(&self.file.path()).await?.len() > COMPRESSION_THRESHOLD
        {
            self.compress_image(file_type).await
        } else {
            Ok(MediaProcessorResult {
                file: self.file,
                thumb: None,
                mime: file_type.mime_type(),
                extension: file_type.extension(),
                original: true,
            })
        }
    }

    async fn compress_image(self, file_type: infer::Type) -> Result<MediaProcessorResult> {
        let compressed = NamedTempFile::new()?;
        if !Command::new("vips")
            .arg("jpegsave")
            .arg("-Q")
            .arg(JPEG_QUALITY.to_string())
            .arg(self.file.path())
            .arg(compressed.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .status()
            .await
            .context("failed to start vips. is it installed?")?
            .success()
        {
            bail!("magick failed to compress image")
        }

        let compressed_size = metadata(compressed.path()).await?.len();
        let original_size = metadata(self.file.path()).await?.len();

        if compressed_size < original_size {
            Ok(MediaProcessorResult {
                file: compressed,
                thumb: None,
                mime: "image/jpeg",
                extension: "jpeg",
                original: false,
            })
        } else {
            Ok(MediaProcessorResult {
                file: self.file,
                thumb: None,
                mime: file_type.mime_type(),
                extension: file_type.extension(),
                original: true,
            })
        }
    }

    async fn file_type(&self) -> Result<infer::Type> {
        let mut buf = [0; HEADER_SIZE];
        let bytes_read = File::open(&self.file.path())
            .await
            .context("Failed to open file for type infer")?
            .read_exact(&mut buf)
            .await
            .context("Failed to read header for type infer")?;
        if bytes_read == 0 {
            bail!("{:?} appears to be empty", &self.file.path())
        }
        infer::Infer::new().get(&buf).ok_or(anyhow!(
            "Could not infer file type for {:?}",
            &self.file.path()
        ))
    }
}

async fn move_file(from: &Path, to: &Utf8Path) -> Result<()> {
    if tokio::fs::rename(from, to).await.is_err() {
        let mut temp_file = File::open(from).await?;
        let mut final_file = File::create(to).await?;

        tokio::io::copy(&mut temp_file, &mut final_file).await?;
        final_file.flush().await?;
    }
    Ok(())
}
