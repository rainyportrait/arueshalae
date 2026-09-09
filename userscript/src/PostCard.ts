import van from "vanjs-core"
import type { ChildDom } from "vanjs-core"

import { Link } from "./Link.ts"
import type { Post } from "./api/post-list.ts"
import { isAnimated } from "./api/tags.ts"
import clsx from "./clsx.ts"
import { setCardSpan } from "./masonry.ts"
import { thumbnailUrl } from "./media-source.ts"
import { postHref, route } from "./router.ts"
import { auth } from "./state/auth.ts"
import { downloaded, queueDownloadCheck } from "./state/downloaded.ts"
import { serverSettings } from "./state/settings.ts"

const { img, span } = van.tags

// On the post list and favorites routes the post link carries the gallery
// origin (which collection it came from and from which page), so the details
// page can offer navigation to the adjacent posts. Any other surface (e.g.
// the profile page) keeps the site's bare link. It follows the route, but is
// evaluated as a live prop (see below) so that `route` is a dependency of the
// anchor only, not of the grid: a plain read here would rebuild every card
// (and reload every <img>) on any navigation.
function cardHref(post: Post): string {
    const r = route.val
    if (r.type === "postlist")
        return postHref(post.link, { kind: "list", tags: r.tags, pid: r.pid })
    if (r.type === "favorites")
        return postHref(post.link, { kind: "favorites", uid: r.id, pid: r.pid })
    return post.link
}

// The "in your library" badge: a heart in the card's corner for posts the
// arueshalae server holds, over a soft darkening of the corner that keeps it
// readable on bright thumbnails. A live child of the card anchor, so a
// settled /api/posts/downloaded (or a server toggle, or a navigation) swaps
// just this node
// — never the card or its img, a swap of which would reload the thumbnail.
// It reads route/auth only inside its own binding, so navigation re-runs the
// badge, not the grid. Hidden on the logged-in user's own favorites page and
// while its old grid remains visible during a details navigation, where the
// server would badge nearly every card (see state/downloaded.ts).
function LibraryBadge({ post }: { post: Post }): ChildDom {
    return () => {
        const r = route.val
        const a = auth.val
        const ownFavorites =
            a.status === "authenticated" &&
            ((r.type === "favorites" && r.id === a.userId) ||
                (r.type === "postdetails" &&
                    r.origin?.kind === "favorites" &&
                    r.origin.uid === a.userId))
        if (ownFavorites || !serverSettings.val.enabled || !downloaded.val.has(post.id))
            return document.createComment("")
        return span(
            {
                // The darkening is a full-card overlay, not a small corner
                // box: its edges coincide with the card's padding box, so
                // the card's own overflow-hidden + rounded-xl clip it exactly
                // like the image and no seam shows. Only the corner is
                // actually darkened (a 32px radial fade that vanishes on
                // dark thumbnails). It is part of the badge node, so a hidden
                // badge leaves the thumbnail untouched. (Icons are CSS masks,
                // so the gradient can't live on the icon span itself.)
                class: clsx(
                    "absolute inset-0 flex items-start justify-end",
                    "bg-[radial-gradient(circle_32px_at_top_right,rgba(0,0,0,0.45),transparent)]",
                ),
            },
            span({
                "icon-name": "heart",
                title: "In your library",
                class: clsx(
                    "mt-1.5 mr-1.5 text-lg text-rose-400",
                    "drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]",
                ),
            }),
        )
    }
}

export function PostCard(post: Post) {
    return Link(
        {
            href: () => cardHref(post),
            class: clsx(
                "masonry-item group relative",
                "block w-full overflow-hidden rounded-xl bg-zinc-900",
                "transition-colors duration-150",
                // Animated posts carry a rose border so they stand out in the
                // grid; the hover state brightens whichever base is set. It is
                // two pixels thick so the accent reads at a glance — border-box
                // sizing keeps the card's outer size identical to its
                // neighbours, and the span is measured after load, so the masonry
                // layout is unaffected.
                isAnimated(post.tags)
                    ? "border-2 border-rose-500/60 hover:border-rose-400/70"
                    : "border border-zinc-800 hover:border-zinc-600",
            ),
            title: `Post #${post.id}`,
        },
        img({
            src: () => {
                queueDownloadCheck(post.id)
                return thumbnailUrl(post)
            },
            alt: `Post ${post.id}`,
            loading: "lazy",
            decoding: "async",
            class: clsx("block transition-transform duration-300 group-hover:scale-[1.03]"),
            // Size the card's grid span once the image has loaded and the card
            // reaches its final height. Fires for lazy and cached images alike.
            onload: (e: Event) => {
                const card = (e.currentTarget as HTMLImageElement).parentElement
                if (card) setCardSpan(card)
            },
            onerror: (e: Event) => {
                const image = e.currentTarget as HTMLImageElement
                if (image.getAttribute("src") !== post.thumbnail) image.src = post.thumbnail
            },
        }),
        LibraryBadge({ post }),
    )
}
