"""Exercise mini-thumbnail cache publication through the real HTTP server."""
import concurrent.futures
import os
import pathlib
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

root = pathlib.Path(__file__).resolve().parents[2]

png = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00"
    b"\x90wS\xde\x00\x00\x00\x0cIDAT\x08\xd7c\xf8\xcf\xc0\x00\x00\x03\x01\x01\x00"
    b"\x18\xdd\x8d\xb8\x00\x00\x00\x00IEND\xaeB`\x82"
)
video = b"test-video-payload"
poster = b"test-video-poster"

with tempfile.TemporaryDirectory(prefix="arue-media-test-") as folder:
    folder = pathlib.Path(folder)
    fake_bin = folder / "bin"
    fake_bin.mkdir()
    state = folder / "vips-state"
    state.mkdir()
    fake_vips = fake_bin / "vipsthumbnail"
    fake_vips.write_text(
        """#!/usr/bin/env python3
import os
import pathlib
import sys
import time

state = pathlib.Path(os.environ["FAKE_VIPS_STATE"])
output = pathlib.Path(sys.argv[sys.argv.index("-o") + 1])
output.write_bytes(b"partial")
if (state / "fail").exists():
    raise SystemExit(1)
(state / "started").touch()
deadline = time.monotonic() + 5
while not (state / "release").exists() and time.monotonic() < deadline:
    time.sleep(0.01)
if not (state / "release").exists():
    raise SystemExit(2)
output.write_bytes(b"complete")
"""
    )
    fake_vips.chmod(0o755)

    db = sqlite3.connect(folder / ".data.db")
    db.executescript((root / "server/src/migrations/202508291609-init.sql").read_text())
    db.executescript(
        """
        INSERT INTO posts (id, external_id, extension, mime, original)
        VALUES (12, 123, 'png', 'image/png', 1),
               (13, 124, 'mp4', 'video/mp4', 1);

        PRAGMA user_version = 1;
        """
    )
    db.close()
    (folder / "0000012_123.png").write_bytes(png)
    (folder / "0000013_124.mp4").write_bytes(video)
    (folder / ".thumbs").mkdir()
    (folder / ".thumbs/0000013_124.mp4.jpeg").write_bytes(poster)

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    environment = os.environ | {
        "FAKE_VIPS_STATE": str(state),
        "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
    }
    process = subprocess.Popen(
        [
            str(root / "server/target/debug/arueshalae"),
            str(folder),
            "--port",
            str(port),
        ],
        env=environment,
    )
    base = f"http://127.0.0.1:{port}"
    mini_path = folder / ".minis/mini_0000012_123.png.jpeg"

    def request_mini():
        with urllib.request.urlopen(base + "/api/posts/123/media?type=mini", timeout=10) as response:
            return response.read()

    try:
        for _ in range(50):
            try:
                with urllib.request.urlopen(base + "/api/posts/count", timeout=1):
                    break
            except urllib.error.URLError:
                time.sleep(0.1)
        else:
            raise AssertionError("server did not start")

        with urllib.request.urlopen(base + "/api/posts/124/media", timeout=10) as response:
            assert response.headers["Content-Type"] == "image/jpeg"
            assert response.read() == poster
        with urllib.request.urlopen(
            urllib.request.Request(
                base + "/api/posts/124/media?type=video",
                headers={"Range": "bytes=5-9"},
            ),
            timeout=10,
        ) as response:
            assert response.status == 206
            assert response.headers["Content-Type"] == "video/mp4"
            assert response.headers["Content-Range"] == f"bytes 5-9/{len(video)}"
            assert response.read() == video[5:10]

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as requests:
            first = requests.submit(request_mini)
            for _ in range(50):
                if (state / "started").exists():
                    break
                time.sleep(0.01)
            else:
                raise AssertionError("thumbnail command did not start")
            assert not mini_path.exists()
            second = requests.submit(request_mini)
            (state / "release").touch()
            assert first.result() == b"complete"
            assert second.result() == b"complete"
        assert mini_path.read_bytes() == b"complete"

        mini_path.unlink()
        (state / "fail").touch()
        try:
            request_mini()
        except urllib.error.HTTPError as error:
            assert error.code == 500
        else:
            raise AssertionError("failed thumbnail generation should return 500")
        assert not mini_path.exists()

        (state / "fail").unlink()
        assert request_mini() == b"complete"
        assert mini_path.read_bytes() == b"complete"
        print("PASS: atomic publication and failed-generation retry")
    finally:
        process.terminate()
        process.wait(timeout=10)
