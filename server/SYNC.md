# Favorite synchronization

Rule34 is the only source of truth. The userscript performs every Rule34 request;
the server only stores the latest complete observation and downloaded media.

Rule34 may change while synchronization or a media download is in flight. Small,
temporary inconsistencies are acceptable when the next explicit Sync repairs them.
Concurrency handling should focus on cases that cannot self-heal, would be expensive
to repair, or have a small and direct fix; it should not grow into background
coordination machinery merely to make a snapshotless upstream appear atomic.

Synchronization is an explicit user action. The first Sync reads every favorites
page and establishes an ordered baseline and the difference between Rule34's
reported count and the number of observed IDs.

Later runs first read the reported count and newest page. New and re-favorited
posts form a prefix. When the remaining remote order is a subsequence of the
baseline, the userscript uses binary search to locate removals. It switches to a
sequential scan when that is cheaper or the ordering assumption does not hold.

The userscript checks each disappeared favorite and each retained post whose removal
has not yet been classified, so the server can distinguish an unfavorite from an
upstream deletion. An ambiguous response aborts the update. Immediately before
publishing every run, it rechecks the count and
newest page so changes made while those checks were in flight are also detected.

The completed ordered list and removal classifications are sent in one request.
`posts.status` is the lifecycle source of truth: `unknown`, `favorited`,
`unfavorited`, or `deleted`. `favorite_order` only stores the ordering of posts
whose status is `favorited`; absent posts and their media remain in the database.

The baseline includes a revision, which the reconciliation request must return.
Favorite actions and completed reconciliations advance this revision. A stale
reconciliation returns HTTP 409 without changing the stored observation; run Sync
again to read a fresh baseline. Deploy the updated userscript alongside the server.
Reconciliation requires explicit `ids`, `reportedCount`, and `revision` fields;
an explicitly empty list is valid, but omitted fields are rejected.

The synchronization API uses descriptive routes:

- `GET /api/sync/status` returns counts and the last completed synchronization.
- `GET /api/sync/baseline` atomically reads the ordered favorite IDs and revision.
- `POST /api/sync/reconcile` accepts `ids`, optional `deleted` and `unfavorited`
  classifications, `reportedCount`, and `revision`, and publishes the complete
  observation atomically.
- `GET /api/posts/status?ids=1,2` returns lifecycle status and downloaded state for
  those posts. The `ids` query is required.
- `GET /api/posts/pending` returns `{ "postIds": [...] }` for current favorites
  whose media is missing, excluding posts confirmed deleted upstream.
- `POST /api/posts/{id}/membership` accepts a `membership` of `favorited` or
  `unfavorited`; a new favorite also supplies the score returned by its upvote.
- `POST /api/posts/{id}/observation` accepts the current `tags` and `score` from
  a post page.
- `POST /api/posts/{id}/status` accepts `favorited` or `deleted` observations from
  the download scan.
- `GET /api/prune` previews the number of confirmed unfavorites eligible for pruning;
  `POST /api/prune` removes their database rows and local media. Pruning is disabled
  until the first complete Sync and always retains posts confirmed deleted upstream.

Upgrading from a server that did not classify retained legacy media resets Sync's
initialized marker. The next Sync re-reads the complete favorites list and classifies
every retained non-favorite before pruning is enabled again.

Favorite-button actions update `favorite_order` immediately. A favorite moves to
the front and opportunistically downloads its media; an unfavorite leaves any
stored media intact.

When the userscript has a favorited post's detail page in hand, it reports the
current tags and score and refreshes its `favorited` status. The server ignores
observations for posts that are not current favorites; an ordinary post visit never
changes lifecycle state. Status reports remain separate because the download scan
must record a confirmed upstream deletion before media exists.

Favorite positions are ordering keys and may have gaps or negative values.
Adding or removing a favorite leaves other rows in place. Full reconciliation
replaces the order, while read-only commands use ordinary read transactions.

After reconciliation, the userscript attempts every current favorite without
media. Missing media itself is the queue. Failures remain eligible for the next
explicit Sync; there are no workers, leases, claims, schedules, persisted retry
state, or stored media URLs.
