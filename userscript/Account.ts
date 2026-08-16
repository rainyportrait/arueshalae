import van from "vanjs-core"

import { CenteredState } from "./CenteredState.ts"
import { PostCard } from "./PostCard.ts"
import type { UserProfile } from "./api/auth.ts"
import type { Post } from "./api/post-list.ts"
import { MASONRY_GAP } from "./masonry.ts"
import { profile, reloadProfile } from "./state/account.ts"

const { div, h2, h3, p } = van.tags

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

function Stat({ label, value }: { label: string; value: number }) {
    return div(
        { class: "rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3" },
        div({ class: "text-2xl font-semibold tabular-nums text-zinc-100" }, value.toLocaleString()),
        div({ class: "mt-0.5 text-xs font-medium uppercase tracking-wider text-zinc-500" }, label),
    )
}

// A "Recent …" section: a heading over a masonry grid of the (few) posts, or a
// muted note when the user has none.
function RecentSection({ title, posts }: { title: string; posts: Post[] }) {
    return div(
        { class: "flex flex-col gap-3" },
        h3({ class: "text-sm font-semibold uppercase tracking-wider text-zinc-400" }, title),
        posts.length === 0
            ? p(
                  {
                      class: "rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-600",
                  },
                  "Nothing here yet.",
              )
            : div(
                  { class: "masonry" },
                  posts.map((post) => PostCard(post)),
              ),
    )
}

function ProfileView({ data }: { data: UserProfile }) {
    return div(
        { class: "mx-auto flex w-full max-w-5xl flex-col gap-8" },
        // Identity
        div(
            { class: "flex flex-col gap-1" },
            h2({ class: "text-3xl font-semibold tracking-tight text-zinc-100" }, data.username),
            p({ class: "text-sm text-zinc-500" }, `Member since ${formatJoinDate(data.joinDate)}`),
        ),
        // Stats
        div(
            { class: "grid grid-cols-2 gap-3" },
            Stat({ label: "Posts", value: data.posts }),
            Stat({ label: "Favorites", value: data.favorites }),
        ),
        RecentSection({ title: "Recent Favorites", posts: data.recentFavorites }),
        RecentSection({ title: "Recent Uploads", posts: data.recentUploads }),
    )
}

// One "recent" section of the skeleton. A factory (not a shared node) so each
// call yields a fresh element — a DOM node can't be parented twice.
function recentSkeleton() {
    return div(
        { class: "flex flex-col gap-3" },
        div({ class: "skeleton h-4 w-32 rounded" }),
        div(
            { class: "masonry" },
            Array.from({ length: 5 }).map(() =>
                div(
                    {
                        class: "masonry-item overflow-hidden rounded-xl border border-zinc-800",
                        style: `grid-row-end: span ${250 + MASONRY_GAP}`,
                    },
                    div({ class: "skeleton w-full", style: "height: 250px" }),
                ),
            ),
        ),
    )
}

// Skeleton mirroring the loaded layout: identity, two stat cards, two recent
// sections.
function LoadingSkeleton() {
    return div(
        { class: "mx-auto flex w-full max-w-5xl flex-col gap-8" },
        div(
            { class: "flex flex-col gap-2" },
            div({ class: "skeleton h-8 w-48 rounded" }),
            div({ class: "skeleton h-4 w-36 rounded" }),
        ),
        div(
            { class: "grid grid-cols-2 gap-3" },
            div({ class: "skeleton h-20 rounded-xl" }),
            div({ class: "skeleton h-20 rounded-xl" }),
        ),
        recentSkeleton(),
        recentSkeleton(),
    )
}

export function Account() {
    return div({ class: "min-h-[60vh]" }, () => {
        const state = profile.val
        if (state.status === "loading") return LoadingSkeleton()
        if (state.status === "error") {
            return CenteredState({
                icon: "⚠️",
                title: "Couldn't load profile",
                message: state.error,
                action: { label: "Try again", onclick: reloadProfile },
            })
        }
        return ProfileView({ data: state })
    })
}
