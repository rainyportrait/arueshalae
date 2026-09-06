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
  last_error TEXT
);

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(post_id),
  tag_id INTEGER NOT NULL REFERENCES tags(tag_id),
  PRIMARY KEY (post_id, tag_id)
);

INSERT INTO posts (post_id, first_seen_at)
SELECT external_id, added_at
FROM legacy_posts;

INSERT INTO favorites (post_id)
SELECT external_id
FROM legacy_posts;

INSERT INTO post_media (
  post_id,
  storage_name,
  extension,
  mime,
  original,
  downloaded_at
)
SELECT
  external_id,
  printf('%07d_%d.%s', id, external_id, extension),
  extension,
  mime,
  original,
  added_at
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
  reconciliation_paused BOOLEAN NOT NULL DEFAULT 0,
  downloads_paused BOOLEAN NOT NULL DEFAULT 0,
  request_budget INTEGER NOT NULL DEFAULT 20
    CHECK (request_budget BETWEEN 1 AND 1000),
  check_interval INTEGER NOT NULL DEFAULT 900 CHECK (check_interval >= 30),
  next_check_at INTEGER NOT NULL DEFAULT 0,
  baseline_run_id INTEGER,
  membership_revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sync_runs (
  sync_run_id INTEGER PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('full', 'incremental')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'running',
      'unresolved',
      'cancelled',
      'complete'
    )
  ),
  phase TEXT NOT NULL DEFAULT 'scan'
    CHECK (phase IN ('scan', 'verify', 'classify')),
  checkpoint INTEGER NOT NULL DEFAULT 0,
  observed_count INTEGER,
  revision INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  retry_after INTEGER NOT NULL DEFAULT 0,
  message TEXT
);

CREATE TABLE sync_order_entries (
  sync_run_id INTEGER NOT NULL REFERENCES sync_runs(sync_run_id),
  position INTEGER NOT NULL,
  post_id INTEGER NOT NULL REFERENCES posts(post_id),
  PRIMARY KEY (sync_run_id, position),
  UNIQUE (sync_run_id, post_id)
);

CREATE TABLE sync_order_ranges (
  sync_run_id INTEGER NOT NULL REFERENCES sync_runs(sync_run_id),
  start_position INTEGER NOT NULL,
  end_position INTEGER NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (sync_run_id, start_position)
);

CREATE TABLE worker_leases (
  worker_kind TEXT PRIMARY KEY
    CHECK (worker_kind IN ('reconciliation', 'download')),
  owner_token TEXT NOT NULL,
  generation INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_progress_at INTEGER NOT NULL,
  current_post_id INTEGER REFERENCES posts(post_id)
);

CREATE TABLE background_pacing (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  next_request_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO background_pacing (singleton) VALUES (1);

CREATE TABLE sync_missing_checks (
  sync_run_id INTEGER NOT NULL REFERENCES sync_runs(sync_run_id),
  post_id INTEGER NOT NULL REFERENCES posts(post_id),
  availability TEXT NOT NULL CHECK (availability IN ('available', 'deleted')),
  PRIMARY KEY (sync_run_id, post_id)
);
