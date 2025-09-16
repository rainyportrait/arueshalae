CREATE TABLE posts (
  id INTEGER PRIMARY KEY NOT NULL,
  external_id INTEGER NOT NULL UNIQUE,

  extension TEXT NOT NULL,
  mime TEXT NOT NULL,
  original BOOLEAN NOT NULL,

  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL
);

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IDX_post_tags_tag_id ON post_tags(tag_id);

CREATE VIEW tags_with_uses AS
SELECT t.id, t.name, t.kind, COUNT(1) uses
FROM post_tags pt
JOIN tags t ON t.id = pt.tag_id
GROUP BY t.name
ORDER BY uses DESC;
