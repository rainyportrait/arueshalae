use std::process::Stdio;

use anyhow::{Result, anyhow, bail};
use camino::{Utf8Path, Utf8PathBuf};
use infer::MatcherType;
use tempfile::NamedTempFile;
use tokio::{
    fs::{File, metadata, remove_file, rename},
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};
use tracing::debug;

const HEADER_SIZE: usize = 0xFF;
const JPEG_QUALITY: u8 = 90;
const COMPRESSION_THRESHOLD: u64 = 3 * 1024 * 1024;
const COMPRESSION_BLACKLIST: &[&str] = &["jpeg", "gif"];

pub struct MediaProcessorResult {
    pub file_name: String,
    pub mime: &'static str,
    pub original: bool,
    cleaner: FileCleaner,
}

impl MediaProcessorResult {
    pub fn commit(self) {
        self.cleaner.commit();
    }
}

struct FileCleaner {
    cleanup_paths: Vec<Utf8PathBuf>,
    should_cleanup: bool,
}

impl FileCleaner {
    fn new() -> Self {
        Self {
            cleanup_paths: Vec::with_capacity(3),
            should_cleanup: true,
        }
    }

    fn add(&mut self, path: &Utf8Path) {
        self.cleanup_paths.push(path.to_owned());
    }

    fn commit(mut self) {
        self.should_cleanup = false;
    }

    fn cleanup(&self) {
        if self.should_cleanup {
            for path in self.cleanup_paths.clone().into_iter() {
                tokio::spawn(async move {
                    _ = remove_file(&path).await;
                });
            }
        }
    }
}

impl Drop for FileCleaner {
    fn drop(&mut self) {
        self.cleanup();
    }
}

pub struct MediaProcessor<'a> {
    dir_path: &'a Utf8Path,
    file_path: Utf8PathBuf,
    post_id: i64,
    sort_id: i64,
    cleaner: FileCleaner,
}

impl<'a> MediaProcessor<'a> {
    pub async fn process(
        dir_path: &'a Utf8Path,
        post_id: i64,
        sort_id: i64,
        temp_file: NamedTempFile,
    ) -> Result<MediaProcessorResult> {
        let cleaner = FileCleaner::new();

        let temp_path =
            Utf8PathBuf::from_path_buf(temp_file.path().to_owned()).expect("utf8 temp path name");

        let processor = Self {
            dir_path,
            post_id,
            sort_id,
            file_path: temp_path,
            cleaner,
        };
        let file_type = processor.file_type().await?;

        Ok(match file_type.matcher_type() {
            MatcherType::Video => processor.process_video(file_type).await?,
            MatcherType::Image => processor.process_image(file_type).await?,
            matched_type => bail!("Unsupported file type: {:#?}", matched_type),
        })
    }

    async fn process_video(mut self, file_type: infer::Type) -> Result<MediaProcessorResult> {
        let file_name = file_name(self.sort_id, self.post_id, file_type.extension());
        let final_path = self.dir_path.join(&file_name);
        self.cleaner.add(&final_path);

        self.make_video_thumbnail(&file_name).await?;
        move_file(&self.file_path, &final_path).await?;

        Ok(MediaProcessorResult {
            file_name,
            mime: file_type.mime_type(),
            original: true,
            cleaner: self.cleaner,
        })
    }

    async fn make_video_thumbnail(&mut self, file_name: &str) -> Result<()> {
        let thumb_path = self
            .dir_path
            .join(".thumbs")
            .join(format!("{file_name}.jpeg",));
        let thumb_time = self.video_duration().await? * 0.1;
        if !Command::new("ffmpeg")
            .arg("-ss")
            .arg(thumb_time.to_string())
            .arg("-i")
            .arg(&self.file_path)
            .arg("-frames:v")
            .arg("1")
            .arg("-q:v")
            .arg("2")
            .arg("-update")
            .arg("1")
            .arg(&thumb_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await?
            .success()
        {
            bail!("ffmpeg failed to create thumbnail")
        };
        self.cleaner.add(&thumb_path);
        Ok(())
    }

    async fn video_duration(&self) -> Result<f32> {
        let output = Command::new("ffprobe")
            .arg("-v")
            .arg("quiet")
            .arg("-i")
            .arg(&self.file_path)
            .arg("-show_entries")
            .arg("format=duration")
            .arg("-of")
            .arg("csv=p=0")
            .output()
            .await?;

        if !output.status.success() {
            bail!("ffprobe failed to get length");
        }

        Ok(String::from_utf8(output.stdout)?
            .lines()
            .next()
            .ok_or(anyhow!("ffprobe did not return video duration"))?
            .parse()?)
    }

    async fn process_image(mut self, file_type: infer::Type) -> Result<MediaProcessorResult> {
        if !COMPRESSION_BLACKLIST.contains(&file_type.extension())
            && metadata(&self.file_path).await?.len() > COMPRESSION_THRESHOLD
        {
            self.compress_image().await
        } else {
            let file_name = file_name(self.sort_id, self.post_id, file_type.extension());
            let final_path = self.dir_path.join(&file_name);
            self.cleaner.add(&final_path);

            move_file(&self.file_path, &final_path).await?;

            Ok(MediaProcessorResult {
                file_name,
                mime: file_type.mime_type(),
                original: true,
                cleaner: self.cleaner,
            })
        }
    }

    async fn compress_image(mut self) -> Result<MediaProcessorResult> {
        let extension = "jpeg";
        let file_name = file_name(self.sort_id, self.post_id, extension);
        let final_path = self.dir_path.join(&file_name);
        self.cleaner.add(&final_path);

        debug!("Compressing file {}", &file_name);

        if !Command::new("magick")
            .arg(&self.file_path)
            .arg("-quality")
            .arg(JPEG_QUALITY.to_string())
            .arg(&final_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await?
            .success()
        {
            bail!("magick failed to compress image")
        }

        Ok(MediaProcessorResult {
            file_name,
            mime: "image/jpeg",
            original: false,
            cleaner: self.cleaner,
        })
    }

    async fn file_type(&self) -> Result<infer::Type> {
        let mut buf = [0; HEADER_SIZE];
        let bytes_read = File::open(&self.file_path)
            .await?
            .read_exact(&mut buf)
            .await?;
        if bytes_read == 0 {
            bail!("{} appears to be empty", &self.file_path)
        }
        infer::Infer::new()
            .get(&buf)
            .ok_or(anyhow!("Could not infer file type"))
    }
}

async fn move_file(from: &Utf8Path, to: &Utf8Path) -> Result<()> {
    if rename(from, to).await.is_err() {
        let mut temp_file = File::open(from).await?;
        let mut final_file = File::create(to).await?;

        tokio::io::copy(&mut temp_file, &mut final_file).await?;
        final_file.flush().await?;
    }
    Ok(())
}

fn file_name(sort_id: i64, post_id: i64, extension: &'static str) -> String {
    format!("{sort_id:07}_{post_id}.{extension}")
}
