# Favorite synchronization

The userscript is the only component that accesses rule34. The server stores
favorite membership, an ordered baseline, downloaded media, and retry state. It
never fetches rule34 pages or media itself.

## Discovery

A manual full scan reads every favorites page in the initiating tab. It verifies
the reported count and first page before publishing the complete order in one
transaction. Closing the tab abandons the scan; there is no resumable server job.

Some rule34 accounts permanently report a favorite count that differs from the
number of IDs on their favorites pages. A successful full scan stores:

```
count offset = reported count - observed IDs
```

Incremental checks subtract that offset before comparing the reported count with
the baseline. A later full scan recalculates it.

Every 15 minutes, open userscript tabs ask the server whether an incremental
check is due. One atomic update admits a single check. There are no worker
identities, leases, generations, heartbeats, or persisted scan runs. The
userscript reconciles the newest page first, then uses binary search against the
established order when the corrected count indicates removals. Only observed,
unambiguous results are committed; otherwise the discrepancy remains unresolved.

## Downloads

Discovery records IDs immediately and leaves media to a separate pull loop. The
server returns one eligible post and places a short soft claim on it. The
userscript fetches its detail page and media, then uploads it. The server checks
current membership when committing the upload, so an unfavorited post is
cancelled and duplicate uploads are harmless.

Failures use a bounded persistent backoff. A soft claim can expire without any
worker takeover protocol; at worst another tab repeats a download.

## Local data

- `post_id` always means the rule34 post ID.
- Favorite membership, upstream availability, and downloaded media are separate.
- Unfavoriting retains existing media and cancels future downloads.
- Confirmed upstream-deleted records and any available media are preserved.
- Media URLs are never stored.
