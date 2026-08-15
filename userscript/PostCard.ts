import van from "vanjs-core/src/van"

import type { Post } from "./api/post-list"
import clsx from "./clsx"

const { a, img } = van.tags

export function PostCard(post: Post) {
    return a(
        {
            href: post.link,
            class: clsx(
                "masonry-item group",
                "block w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900",
                "transition-colors duration-150 hover:border-zinc-600",
            ),
            title: `Post #${post.id}`,
        },
        img({
            src: post.thumbnail,
            alt: `Post ${post.id}`,
            loading: "lazy",
            decoding: "async",
            class: clsx("block transition-transform duration-300 group-hover:scale-[1.03]"),
        }),
    )
}
