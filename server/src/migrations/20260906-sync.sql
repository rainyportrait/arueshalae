DROP VIEW tags_with_uses;

ALTER TABLE posts RENAME TO legacy_posts;
ALTER TABLE post_tags RENAME TO legacy_post_tags;
ALTER TABLE tags RENAME COLUMN id TO tag_id;

CREATE TABLE posts (
  post_id INTEGER PRIMARY KEY NOT NULL CHECK (post_id > 0),
  availability TEXT NOT NULL DEFAULT 'unknown'
    CHECK (availability IN ('unknown', 'available', 'deleted')),
  details_checked_at INTEGER,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE favorites (
  post_id INTEGER PRIMARY KEY NOT NULL REFERENCES posts(post_id),
  membership TEXT NOT NULL DEFAULT 'unknown'
    CHECK (membership IN ('unknown', 'favorited', 'unfavorited')),
  membership_checked_at INTEGER,
  last_known_position INTEGER
);

CREATE TABLE post_media (
  post_id INTEGER PRIMARY KEY NOT NULL REFERENCES posts(post_id),
  storage_name TEXT NOT NULL UNIQUE,
  extension TEXT NOT NULL,
  mime TEXT NOT NULL,
  original BOOLEAN NOT NULL,
  downloaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE download_queue (
  post_id INTEGER PRIMARY KEY NOT NULL REFERENCES posts(post_id),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(post_id),
  tag_id INTEGER NOT NULL REFERENCES tags(tag_id),
  PRIMARY KEY (post_id, tag_id)
);

INSERT INTO posts (post_id, first_seen_at)
SELECT external_id, added_at FROM legacy_posts;

INSERT INTO favorites (post_id)
SELECT external_id FROM legacy_posts;

INSERT INTO post_media (post_id, storage_name, extension, mime, original, downloaded_at)
SELECT external_id, printf('%07d_%d.%s', id, external_id, extension),
       extension, mime, original, added_at
FROM legacy_posts;

INSERT INTO post_tags (post_id, tag_id)
SELECT legacy_posts.external_id, legacy_post_tags.tag_id
FROM legacy_post_tags
JOIN legacy_posts ON legacy_posts.id = legacy_post_tags.post_id;

DROP TABLE legacy_post_tags;
DROP TABLE legacy_posts;

CREATE INDEX IDX_post_tags_tag_id ON post_tags(tag_id);

CREATE VIEW tags_with_uses AS
SELECT tags.tag_id, tags.name, tags.kind, COUNT(*) AS uses
FROM tags
JOIN post_tags USING (tag_id)
GROUP BY tags.tag_id;

CREATE TABLE sync_account (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  rule34_user_id INTEGER NOT NULL CHECK (rule34_user_id > 0),
  count_offset INTEGER NOT NULL DEFAULT 0,
  baseline_ready BOOLEAN NOT NULL DEFAULT 0,
  request_budget INTEGER NOT NULL DEFAULT 20 CHECK (request_budget BETWEEN 1 AND 1000),
  incremental_paused BOOLEAN NOT NULL DEFAULT 0,
  downloads_paused BOOLEAN NOT NULL DEFAULT 0,
  next_incremental_at INTEGER NOT NULL DEFAULT 0,
  membership_revision INTEGER NOT NULL DEFAULT 0,
  last_incremental_at INTEGER,
  last_full_scan_at INTEGER,
  last_result TEXT
);

CREATE TABLE favorite_order (
  position INTEGER PRIMARY KEY NOT NULL CHECK (position >= 0),
  post_id INTEGER NOT NULL UNIQUE REFERENCES posts(post_id)
);
