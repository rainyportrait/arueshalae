"""Exercise the real HTTP server against a disposable migrated database."""
import binascii
import json
import pathlib
import socket
import sqlite3
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

root = pathlib.Path(__file__).resolve().parents[2]


def chunk(kind, data):
    return (
        struct.pack("!I", len(data))
        + kind
        + data
        + struct.pack("!I", binascii.crc32(kind + data) & 0xFFFFFFFF)
    )


png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack("!2I5B", 16, 16, 8, 2, 0, 0, 0))
    + chunk(
        b"IDAT",
        zlib.compress(
            b"".join(
                b"\0" + bytes((x * 17 + y * 13) % 256 for x in range(48))
                for y in range(16)
            )
        ),
    )
    + chunk(b"IEND", b"")
)
assert len(png) > 255
with tempfile.TemporaryDirectory(prefix="arue-sync-test-") as folder:
    folder = pathlib.Path(folder)
    db = sqlite3.connect(folder / ".data.db")
    db.executescript((root / "server/src/migrations/202508291609-init.sql").read_text())
    db.executescript(
        """
        INSERT INTO posts (id, external_id, extension, mime, original)
        VALUES (12, 123, 'png', 'image/png', 1);

        INSERT INTO tags (id, name, kind)
        VALUES (1, 'test', 'general');

        INSERT INTO post_tags (post_id, tag_id) VALUES (12, 1);

        PRAGMA user_version = 1;
        """
    )
    db.close()
    (folder / "0000012_123.png").write_bytes(png)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with (folder / "log").open("w") as log:
        process = subprocess.Popen(
            [
                str(root / "server/target/debug/arueshalae"),
                str(folder),
                "--port",
                str(port),
            ],
            stdout=log,
            stderr=log,
        )
        base = f"http://127.0.0.1:{port}"

        def req(path, data=None, headers=None):
            with urllib.request.urlopen(
                urllib.request.Request(base + path, data=data, headers=headers or {}),
                timeout=10,
            ) as response:
                return response.read()

        def get_json(path):
            return json.loads(req(path))

        def post_json(path, **fields):
            return json.loads(
                req(
                    path,
                    json.dumps(fields).encode(),
                    {"Content-Type": "application/json"},
                )
            )

        def rejected_post(status, path, **fields):
            try:
                post_json(path, **fields)
            except urllib.error.HTTPError as error:
                assert error.code == status, error.read()
            else:
                raise AssertionError(f"{path} should return {status}")

        def rejected_request(status, path, data=None, headers=None):
            try:
                req(path, data, headers)
            except urllib.error.HTTPError as error:
                assert error.code == status, error.read()
                return error.read()
            raise AssertionError(f"{path} should return {status}")

        def upload(post_id, image=png, post_tags=None):
            if post_tags is None:
                post_tags = [{"name": "new_tag", "kind": "general"}]
            image_headers = (
                b'--test\r\nContent-Disposition: form-data; name="image"; '
                b'filename="test.png"\r\nContent-Type: image/png\r\n\r\n'
            )
            tags = (
                b'\r\n--test\r\nContent-Disposition: form-data; name="tags"\r\n\r\n'
                + json.dumps(post_tags).encode()
                + b'\r\n--test--\r\n'
            )
            body = image_headers + image + tags
            return json.loads(
                req(
                    f"/api/posts/{post_id}",
                    body,
                    {"Content-Type": "multipart/form-data; boundary=test"},
                )
            )

        try:
            for _ in range(50):
                try:
                    req("/api/posts/count")
                    break
                except Exception:
                    time.sleep(0.1)
            assert req("/api/posts/123/media") == png
            assert get_json("/api/sync/status")["initialized"] is False
            post_json("/api/posts/123/membership", membership="unfavorited")
            assert req("/api/posts/123/media") == png
            post_json("/api/posts/123/membership", membership="favorited")
            assert upload(123) == {"ok": True}
            assert (folder / "0000012_123.png").read_bytes() == png
            assert not (folder / "123.png").exists()
            post_json("/api/posts/456/membership", membership="favorited")
            post_json("/api/posts/456/membership", membership="unfavorited")
            assert upload(456) == {"cancelled": True}
            assert not (folder / "456.png").exists()
            post_json("/api/posts/456/membership", membership="favorited")
            assert upload(456) == {"ok": True}
            assert req("/api/posts/456/media") == png
            post_json(
                "/api/sync/reconcile",
                ids=[456, 123],
                reportedCount=5,
                revision=get_json("/api/sync/baseline")["revision"],
            )
            assert get_json("/api/sync/status")["countOffset"] == 3
            assert get_json("/api/sync/baseline")["ids"] == [456, 123]
            assert get_json("/api/posts/pending") == {"postIds": []}
            assert json.loads(req("/api/posts/downloaded?ids=123,456,789")) == {
                "postIds": [123, 456]
            }
            assert post_json(
                "/api/posts/900/observation",
                tags=[{"name": "ignored", "kind": "general"}],
            ) == {"observed": False}
            assert post_json(
                "/api/posts/901/availability", availability="deleted"
            ) == {"ok": True}
            db = sqlite3.connect(folder / ".data.db")
            assert db.execute("SELECT COUNT(*) FROM posts WHERE post_id=900").fetchone() == (0,)
            assert db.execute(
                "SELECT availability FROM posts WHERE post_id=901"
            ).fetchone() == ("deleted",)
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            assert db.execute(
                "SELECT post_id FROM post_tags WHERE tag_id=1"
            ).fetchall() == [(123,)]

            baseline = get_json("/api/sync/baseline")
            rejected_post(400, "/api/sync/reconcile")
            rejected_post(400, "/api/sync/reconcile", ids=[], revision=baseline["revision"])
            rejected_post(400, "/api/posts/123/membership", membership="invalid")
            rejected_request(400, "/api/posts/status")
            rejected_request(400, "/api/posts/status?ids=123,nope")
            assert get_json("/api/sync/baseline") == baseline

            post_json("/api/posts/789/membership", membership="favorited")
            rejected_post(
                409,
                "/api/sync/reconcile",
                ids=baseline["ids"],
                reportedCount=5,
                revision=baseline["revision"],
            )
            assert get_json("/api/sync/baseline")["ids"] == [789, 456, 123]

            # Reads must remain available while another connection reserves the writer.
            db.execute("BEGIN IMMEDIATE")
            try:
                assert get_json("/api/sync/status")["favorites"] == 3
                assert get_json("/api/sync/baseline")["ids"] == [789, 456, 123]
                assert get_json("/api/posts/pending")["postIds"] == [789]
                statuses = get_json("/api/posts/status?ids=123,456,789")["posts"]
                assert len(statuses) == 3
                assert set(statuses[0]) == {
                    "postId", "membership", "availability", "downloaded"
                }
            finally:
                db.rollback()

            tiny_png = (
                b"\x89PNG\r\n\x1a\n"
                + chunk(b"IHDR", struct.pack("!2I5B", 1, 1, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(b"\0\xff\0\0"))
                + chunk(b"IEND", b"")
            )
            assert len(tiny_png) < 255
            assert upload(
                789, tiny_png,
                [{"name": "cat", "kind": "general"}, {"name": "dog", "kind": "general"}],
            ) == {"ok": True}
            assert req("/api/posts/789/media") == tiny_png
            post_json("/api/posts/790/membership", membership="favorited")
            assert upload(790, tiny_png, [{"name": "cat", "kind": "general"}]) == {"ok": True}

            def search(term):
                result = req("/api/posts/search?term=" + urllib.parse.quote(term))
                return json.loads(result)["postIds"]

            assert search("cat") == [790, 789]
            assert search("cat cat") == [790, 789]
            assert search("cat -dog") == [790]
            assert set(search("-dog")) == {790, 456, 123}
            assert set(search("")) == {790, 789, 456, 123}
            suggestions = json.loads(req("/api/tags?term="))["tags"]
            assert suggestions[0]["name"] == "cat"
            assert suggestions[0]["uses"] == 2

            rejected_request(404, "/api/posts/999/media")
            original = folder / "0000012_123.png"
            original.rename(folder / "hidden.png")
            try:
                rejected_request(404, "/api/posts/123/media")
                rejected_request(404, "/api/posts/123/media?type=mini")
            finally:
                (folder / "hidden.png").rename(original)

            rejected_request(
                400, "/api/posts/123",
                b'--test\r\nContent-Disposition: form-data; name="tags"\r\n\r\n{bad json}\r\n--test--\r\n',
                {"Content-Type": "multipart/form-data; boundary=test"},
            )
            rejected_request(
                400, "/api/posts/123", b"--test--\r\n",
                {"Content-Type": "multipart/form-data; boundary=test"},
            )

            # A database failure must be a logged 500, not a misleading 404.
            db.execute("ALTER TABLE post_media RENAME TO unavailable_media")
            db.commit()
            try:
                assert rejected_request(500, "/api/posts/123/media") == b"Internal server error"
            finally:
                db.execute("ALTER TABLE unavailable_media RENAME TO post_media")
                db.commit()
            assert "post_media" in (folder / "log").read_text()
            db.close()
            print(
                "PASS: legacy migration, original filenames, retained media, "
                "re-favorite reuse, cancelled upload, real media upload/read, "
                "count offset, ordered favorites, filtered IDs, tag links, foreign keys, "
                "invalid commands, stale reconciliation, concurrent reads, small images, "
                "search filters, autocomplete ranking, HTTP error classification"
            )
        finally:
            process.terminate()
            process.wait(timeout=10)
            if process.returncode not in (0, -15):
                print((folder / "log").read_text())
