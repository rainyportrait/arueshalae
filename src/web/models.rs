use camino::{Utf8Path, Utf8PathBuf};

pub struct Post {
    pub id: i64,
    pub file_name: String,
    pub mime: String,
}

impl Post {
    pub fn image_path(&self, base_path: &Utf8Path) -> Utf8PathBuf {
        if self.is_video() {
            base_path
                .join(".thumbs")
                .join(format!("{}.jpeg", self.file_name))
        } else {
            base_path.join(&self.file_name)
        }
    }

    pub fn is_video(&self) -> bool {
        self.mime.starts_with("video")
    }
}

pub struct Tag {
    pub id: i64,
    pub name: String,
    pub uses: i64,
}
