ALTER TABLE sync_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

-- Allow negative ordering keys so favoriting a post only changes that row.
ALTER TABLE favorite_order RENAME TO previous_favorite_order;

CREATE TABLE favorite_order (
  position INTEGER PRIMARY KEY NOT NULL,
  post_id INTEGER NOT NULL UNIQUE REFERENCES posts(post_id)
);

INSERT INTO favorite_order (position, post_id)
SELECT position, post_id FROM previous_favorite_order;

DROP TABLE previous_favorite_order;
