import van from "vanjs-core"

import { CenteredState } from "./CenteredState.ts"
import { Link } from "./Link.ts"
import { PostCard } from "./PostCard.ts"
import type { UserProfile } from "./api/auth.ts"
import type { Post } from "./api/post-list.ts"
import clsx from "./clsx.ts"
import { MASONRY_GAP } from "./masonry.ts"
import { routeToUrl } from "./router.ts"
import { profile, reloadProfile } from "./state/account.ts"

const { div, h2, p } = van.tags

// "2014-11-12" -> "November 12, 2014"; the raw string when it doesn't parse as
// a date. The `T00:00:00` pins it to local midnight so negative time zones
// don't shift the day.
function formatJoinDate(raw: string): string {
    const date = new Date(`${raw}T00:00:00`)
    if (Number.isNaN(date.getTime())) return raw
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    }).format(date)
}

// A topic section: a header (count + label on the left, a "View all" link on
// the right) over a masonry grid of the recent items — so a topic's link,
// count, and recents live together instead of being scattered across the page.
// Borderless on purpose: the PostCards below are already cards, so wrapping
// them in another bordered box read as cards-within-cards. A null href
// (favorites, when the numeric id is unavailable) hides the link.
function TopicPanel({
    title,
    count,
    href,
    posts,
}: {
    title: string
    count: number
    href: string | null
    posts: Post[]
}) {
    return div(
        { class: clsx("flex flex-col gap-3") },
        div(
            { class: clsx("flex items-center justify-between gap-3") },
            div(
                { class: clsx("flex items-baseline gap-2") },
                div(
                    { class: clsx("text-2xl font-semibold text-zinc-100 tabular-nums") },
                    count.toLocaleString(),
                ),
                div(
                    { class: clsx("text-xs font-medium tracking-wider text-zinc-500 uppercase") },
                    title,
                ),
            ),
            href === null
                ? document.createComment("")
                : Link(
                      {
                          href,
                          class: clsx("text-sm font-medium text-rose-400 hover:text-rose-300"),
                      },
                      "View all",
                  ),
        ),
        posts.length === 0
            ? p(
                  {
                      class: clsx(
                          "rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-600",
                      ),
                  },
                  "Nothing here yet.",
              )
            : div(
                  { class: clsx("masonry") },
                  posts.map((post) => PostCard(post)),
              ),
    )
}

function ProfileView({ data }: { data: UserProfile }) {
    return div(
        { class: clsx("mx-auto flex w-full max-w-5xl flex-col gap-6") },
        // Identity
        div(
            { class: clsx("flex flex-col gap-1") },
            h2(
                { class: clsx("text-3xl font-semibold tracking-tight text-zinc-100") },
                data.username,
            ),
            p(
                { class: clsx("text-sm text-zinc-500") },
                `Member since ${formatJoinDate(data.joinDate)}`,
            ),
        ),
        // One section per topic: the count, the "View all" link, and the recent
        // items are grouped together. The favorites link needs the numeric id,
        // which is only present when the profile page exposed it.
        TopicPanel({
            title: "Posts",
            count: data.posts,
            href: routeToUrl({ type: "postlist", tags: `user:${data.username}`, pid: 0 }),
            posts: data.recentUploads,
        }),
        TopicPanel({
            title: "Favorites",
            count: data.favorites,
            href: data.id > 0 ? routeToUrl({ type: "favorites", id: data.id, pid: 0 }) : null,
            posts: data.recentFavorites,
        }),
    )
}

// A factory (not a shared node) so each call yields a fresh skeleton.
function panelSkeleton() {
    return div(
        { class: clsx("flex flex-col gap-3") },
        div(
            { class: clsx("flex items-center justify-between gap-3") },
            div(
                { class: clsx("flex items-baseline gap-2") },
                div({ class: clsx("skeleton h-6 w-16 rounded") }),
                div({ class: clsx("skeleton h-3 w-20 rounded") }),
            ),
            div({ class: clsx("skeleton h-4 w-16 rounded") }),
        ),
        div(
            { class: clsx("masonry") },
            Array.from({ length: 5 }).map(() =>
                div(
                    {
                        class: clsx(
                            "masonry-item overflow-hidden rounded-xl border border-zinc-800",
                        ),
                        style: `grid-row-end: span ${250 + MASONRY_GAP}`,
                    },
                    div({ class: clsx("skeleton w-full"), style: "height: 250px" }),
                ),
            ),
        ),
    )
}

// Skeleton mirroring the loaded layout: identity, then one topic section each
// for Posts and Favorites.
function LoadingSkeleton() {
    return div(
        { class: clsx("mx-auto flex w-full max-w-5xl flex-col gap-6") },
        div(
            { class: clsx("flex flex-col gap-2") },
            div({ class: clsx("skeleton h-8 w-48 rounded") }),
            div({ class: clsx("skeleton h-4 w-36 rounded") }),
        ),
        panelSkeleton(),
        panelSkeleton(),
    )
}

export function Account() {
    return div({ class: clsx("min-h-[60vh]") }, () => {
        const state = profile.val
        if (state.status === "error") {
            return CenteredState({
                icon: "⚠️",
                title: "Couldn't load profile",
                message: state.error,
                action: { label: "Try again", onclick: reloadProfile },
            })
        }
        // While a new profile loads, the state keeps the previous one (see
        // state/load.ts), which is what renders here; only the very first load
        // has no profile and falls back to the skeleton.
        const data: UserProfile | null = state.status === "ready" ? state : null
        if (data === null) return LoadingSkeleton()
        return ProfileView({ data })
    })
}
