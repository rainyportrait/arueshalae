DROP VIEW tags_with_uses;

ALTER TABLE favorite_order RENAME TO previous_favorite_order;
ALTER TABLE post_tags RENAME TO previous_post_tags;
ALTER TABLE post_media RENAME TO previous_post_media;
ALTER TABLE posts RENAME TO previous_posts;

CREATE TABLE posts (
  post_id INTEGER PRIMARY KEY NOT NULL CHECK (post_id > 0),
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown', 'favorited', 'unfavorited', 'deleted')),
  details_checked_at INTEGER,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  score INTEGER NOT NULL DEFAULT 0
);

INSERT INTO posts (post_id, status, details_checked_at, first_seen_at, score)
SELECT p.post_id,
       CASE WHEN f.post_id IS NOT NULL THEN 'favorited'
            WHEN p.availability = 'deleted' THEN 'deleted'
            ELSE 'unknown' END,
       p.details_checked_at, p.first_seen_at, p.score
FROM previous_posts p
LEFT JOIN previous_favorite_order f USING (post_id);

CREATE TABLE post_media (
  post_id INTEGER PRIMARY KEY NOT NULL REFERENCES posts(post_id),
  storage_name TEXT NOT NULL UNIQUE,
  extension TEXT NOT NULL,
  mime TEXT NOT NULL,
  original BOOLEAN NOT NULL,
  downloaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO post_media SELECT * FROM previous_post_media;

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(post_id),
  tag_id INTEGER NOT NULL REFERENCES tags(tag_id),
  PRIMARY KEY (post_id, tag_id)
);
INSERT INTO post_tags SELECT * FROM previous_post_tags;

CREATE TABLE favorite_order (
  position INTEGER PRIMARY KEY NOT NULL,
  post_id INTEGER NOT NULL UNIQUE REFERENCES posts(post_id)
);
INSERT INTO favorite_order SELECT * FROM previous_favorite_order;

DROP TABLE previous_favorite_order;
DROP TABLE previous_post_tags;
DROP TABLE previous_post_media;
DROP TABLE previous_posts;

CREATE INDEX IDX_post_tags_tag_id ON post_tags(tag_id);
CREATE VIEW tags_with_uses AS
SELECT tags.tag_id, tags.name, tags.kind, COUNT(*) AS uses
FROM tags
JOIN post_tags USING (tag_id)
GROUP BY tags.tag_id;

-- Force one complete observation so every retained non-favorite receives an
-- explicit unfavorited/deleted classification before pruning is enabled.
UPDATE sync_state SET initialized = 0;
