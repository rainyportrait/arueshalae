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

        def command(action, **fields):
            return json.loads(
                req(
                    "/api/sync",
                    json.dumps(dict(userId=7, action=action, **fields)).encode(),
                    {"Content-Type": "application/json"},
                )
            )

        def upload(post_id):
            image_headers = (
                b'--test\r\nContent-Disposition: form-data; name="image"; '
                b'filename="test.png"\r\nContent-Type: image/png\r\n\r\n'
            )
            tags = (
                b'\r\n--test\r\nContent-Disposition: form-data; name="tags"\r\n\r\n'
                b'[{"name":"new_tag","kind":"general"}]\r\n--test--\r\n'
            )
            body = image_headers + png + tags
            return json.loads(
                req(
                    f"/api/posts/{post_id}?userId=7",
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
            assert command("status") == {"configured": False}
            command("configure")
            command("membership", postId=123, value="unfavorited")
            assert req("/api/posts/123/media") == png
            assert command("status")["archived"] == 1
            command("membership", postId=123, value="favorited")
            assert upload(123) == {"ok": True}
            assert (folder / "0000012_123.png").read_bytes() == png
            assert not (folder / "123.png").exists()
            command("membership", postId=456, value="favorited")
            command("membership", postId=456, value="unfavorited")
            assert upload(456) == {"cancelled": True}
            assert not (folder / "456.png").exists()
            command("membership", postId=456, value="favorited")
            assert upload(456) == {"ok": True}
            assert req("/api/posts/456/media") == png
            baseline = command("baseline")
            command(
                "full-scan",
                ids=[456, 123],
                reportedCount=5,
                revision=baseline["revision"],
            )
            assert command("status")["countOffset"] == 3
            db = sqlite3.connect(folder / ".data.db")
            db.execute("UPDATE sync_account SET next_incremental_at = 0")
            db.commit()
            db.close()
            assert command("claim-incremental") == {"run": True}
            assert command("claim-incremental") == {"run": False}
            assert json.loads(req("/api/posts/downloaded?ids=123,456,789")) == {
                "postIds": [123, 456]
            }
            db = sqlite3.connect(folder / ".data.db")
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            assert db.execute(
                "SELECT post_id FROM post_tags WHERE tag_id=1"
            ).fetchall() == [(123,)]
            assert db.execute(
                "SELECT COUNT(*) FROM download_queue WHERE post_id=456"
            ).fetchone() == (0,)
            print(
                "PASS: legacy migration, original filenames, retained media, "
                "re-favorite reuse, cancelled upload, real media upload/read, "
                "count offset, one-shot claim, filtered IDs, tag links, foreign keys"
            )
        finally:
            process.terminate()
            process.wait(timeout=10)
            if process.returncode not in (0, -15):
                print((folder / "log").read_text())
