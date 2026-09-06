# Favorite synchronization

The server stores state and media; only the userscript contacts rule34.

In userscript Settings, enable the server, configure the signed-in account, and
start the initial full scan. This is an explicit account binding: another account
cannot update its membership. Existing downloads migrate with unknown membership
and retain their original filenames. No production scan starts during migration.

Full scans collect ordered IDs, then verify the pages in a second pass. Missing
posts are checked individually and classification progress is persisted. A final
count and head-page check precedes publication. Network interruptions back off and
resume; inconsistent observations require starting another full scan. These are
observations of a changing paginated site, not an atomic upstream snapshot.

Incremental checks run on connection and every 15 minutes, spending at most 20
upstream requests per attempt. They inspect the front even when counts agree,
reconcile additions/re-additions, and binary-search discrepancies against the
ordered baseline. Ambiguous ordering or exhausted budgets report unresolved work.
Matching counts do not prove complete agreement. Full scans remain manual.

Each lane acquires its own 60-second server lease, renewing every 20 seconds while
making progress or awaiting a bounded operation. Waiting tabs poll with jitter
around 15 seconds. Expired generations cannot publish sync results. Background
request starts are spaced by the server and use the userscript request queue.
Upstream document requests time out after 30 seconds. Challenges yield the worker;
they never count as evidence that a post was deleted.

The download lane requests one eligible post at a time, fetches its details and
media, and uploads it. No media URL is stored. Media requests and uploads each have
a five-minute timeout. Failed posts back off, allowing other posts to proceed;
five failures require a manual retry. Membership changes do not delete files.
Uploads are accepted for active favorites or preserved upstream-deleted records,
and cancelled for unfavorited posts. Existing media makes an upload idempotent.

Settings exposes independent global pause controls, full-scan cancellation,
download retries, separate counts, and local-library filters. Opening a downloaded
record serves its local media. An upstream 404/410 (excluding challenge responses)
is deletion evidence; an unrecognized successful page stays unresolved.

## Storage

`post_id` always means the rule34 ID. Rust uses distinct `PostId`, `Rule34UserId`,
`TagId`, and `SyncRunId` types. `post_media.storage_name` preserves legacy filenames;
new media uses `<post_id>.<extension>`. The presence of a media row means the file
was successfully committed. Membership, availability, and pending download work
are independent records.

The schema migration is transactional and runs automatically on server startup.
It does not rename or delete existing media. Old clients that permanently deleted
posts must be replaced with the rebuilt userscript; the DELETE endpoint is removed.

## Verification

From the repository root:

```sh
cargo test --manifest-path server/Cargo.toml
cargo build --manifest-path server/Cargo.toml
python server/tests/sync_integration.py
```

The integration check starts a disposable localhost server and verifies migration,
legacy filenames, retained media, cancelled uploads, duplicate upload reuse, real
media serving, and foreign-key integrity. It never opens the production database.
Run the remaining checks listed in `AGENTS.md` before shipping changes.
