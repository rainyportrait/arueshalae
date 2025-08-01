CREATE VIEW tags_with_uses AS
SELECT t.id, t.name, COUNT(1) uses
FROM post_tags pt
JOIN tags t ON t.id = pt.tag_id
GROUP BY t.name
ORDER BY uses DESC;
