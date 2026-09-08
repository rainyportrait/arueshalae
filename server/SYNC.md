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

Before publishing a longer run, the userscript rechecks the count and newest
page. It checks each disappeared post's detail page so the server can distinguish
an unfavorite from an upstream deletion. An ambiguous response aborts the update.

The completed ordered list is sent in one request. Presence in `favorite_order`
means that a post is currently favorited; absent posts and their media remain in
the database. `posts.availability` separately records confirmed upstream
deletions.

Favorite-button actions update `favorite_order` immediately. A favorite moves to
the front and opportunistically downloads its media; an unfavorite leaves any
stored media intact.

After reconciliation, the userscript attempts every current favorite without
media. Missing media itself is the queue. Failures remain eligible for the next
explicit Sync; there are no workers, leases, claims, schedules, persisted retry
state, or stored media URLs.
