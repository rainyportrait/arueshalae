import van from "vanjs-core"

import { Link } from "./Link.ts"
import type { Post } from "./api/post-list.ts"
import { isAnimated } from "./api/tags.ts"
import clsx from "./clsx.ts"
import { setCardSpan } from "./masonry.ts"
import { postHref, route } from "./router.ts"

const { img } = van.tags

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

export function PostCard(post: Post) {
    return Link(
        {
            href: () => cardHref(post),
            class: clsx(
                "masonry-item group",
                "block w-full overflow-hidden rounded-xl border bg-zinc-900",
                "transition-colors duration-150",
                // Animated posts carry a rose border so they stand out in the
                // grid; the hover state brightens whichever base is set.
                isAnimated(post.tags)
                    ? "border-rose-500/60 hover:border-rose-400/70"
                    : "border-zinc-800 hover:border-zinc-600",
            ),
            title: `Post #${post.id}`,
        },
        img({
            src: post.thumbnail,
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
        }),
    )
}
