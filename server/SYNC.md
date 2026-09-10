# Favorite synchronization

Rule34 is the only source of truth. The userscript performs every Rule34 request;
the server only stores the latest complete observation and downloaded media.

Synchronization is an explicit user action. The first Sync reads every favorites
page and establishes an ordered baseline and the difference between Rule34's
reported count and the number of observed IDs.

Later runs first read the reported count and newest page. New and re-favorited
posts form a prefix. When the remaining remote order is a subsequence of the
baseline, the userscript uses binary search to locate removals. It switches to a
sequential scan when that is cheaper or the ordering assumption does not hold.

The userscript checks each disappeared post's detail page so the server can
distinguish an unfavorite from an upstream deletion. An ambiguous response aborts
the update. Immediately before publishing every run, it rechecks the count and
newest page so changes made while those checks were in flight are also detected.

The completed ordered list is sent in one request. Presence in `favorite_order`
means that a post is currently favorited; absent posts and their media remain in
the database. `posts.availability` separately records confirmed upstream
deletions.

The baseline includes a revision, which the reconciliation request must return.
Favorite actions and completed reconciliations advance this revision. A stale
reconciliation returns HTTP 409 without changing the stored observation; run Sync
again to read a fresh baseline. Deploy the updated userscript alongside the server.
Reconciliation requires explicit `ids`, `reportedCount`, and `revision` fields;
an explicitly empty list is valid, but omitted fields are rejected.

The synchronization API uses descriptive routes:

- `GET /api/sync/status` returns counts and the last completed synchronization.
- `GET /api/sync/baseline` atomically reads the ordered favorite IDs and revision.
- `POST /api/sync/reconcile` accepts `ids`, optional `deleted`, `reportedCount`, and
  `revision` and publishes the complete observation atomically.
- `GET /api/posts/status?ids=1,2` returns membership, availability, and downloaded
  state for those posts. The `ids` query is required.
- `GET /api/posts/pending` returns `{ "postIds": [...] }` for current favorites
  whose media is missing, excluding posts confirmed deleted upstream.
- `POST /api/posts/{id}/membership` accepts a `membership` of `favorited` or
  `unfavorited`.
- `POST /api/posts/{id}/observation` accepts the current `tags` from a post page.
- `POST /api/posts/{id}/availability` accepts an `availability` of `available` or
  `deleted`.

Favorite-button actions update `favorite_order` immediately. A favorite moves to
the front and opportunistically downloads its media; an unfavorite leaves any
stored media intact.

When the userscript has a favorited post's detail page in hand, it reports the
current tags and availability. The server ignores observations for posts that
are not current favorites; an ordinary post visit never creates membership.
Availability reports remain separate: they can create a post record because the
download scan must record a confirmed upstream deletion before media exists.

Favorite positions are ordering keys and may have gaps or negative values.
Adding or removing a favorite leaves other rows in place. Full reconciliation
replaces the order, while read-only commands use ordinary read transactions.

After reconciliation, the userscript attempts every current favorite without
media. Missing media itself is the queue. Failures remain eligible for the next
explicit Sync; there are no workers, leases, claims, schedules, persisted retry
state, or stored media URLs.
