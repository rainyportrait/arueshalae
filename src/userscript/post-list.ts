import van from "vanjs-core"
import { fetchFilteredId, filterForDownloadedIds } from "./network"
import { getPostIds, syncSingle } from "./downloader"

const { div, a, span } = van.tags

export async function postList() {
  const favoritedIds = await filterForDownloadedIds(getPostIds(document))
  for (const id of favoritedIds) {
    highlightPost(id)
  }
  addFavoritesButtons(favoritedIds)
}

function addFavoritesButtons(favoritedIds: number[]) {
  Array.from(document.querySelectorAll(".thumb")).forEach(t => {
    const id = t.querySelector("a")?.id.substring(1)
    if (!id) return
    van.add(t, FavoriteButton(id, favoritedIds.includes(Number.parseInt(id))))
  })
}

export function FavoriteButton(id: string, favorited: boolean, highlightOnFavorite = false) {
  const isInFavorites = van.state(favorited)
  const isBeingAdded = van.state(false)
  return () => {
    if (isInFavorites.val) {
      return div(span("In favorites"))
    }

    if (isBeingAdded.val) {
      return div(span("Adding to favorites"))
    }

    return div(
      a(
        {
          href: `javascript:void()`,
          onclick: async () => {
            isBeingAdded.val = true

            unsafeWindow.post_vote(id, "up")
            unsafeWindow.addFav(id)

            const parsedId = Number.parseInt(id)
            if (!(await fetchFilteredId(parsedId))) return
            await syncSingle(parsedId)
            highlightPost(parsedId)
            isInFavorites.val = true
          },
        },
        "Add to favorites",
      ),
    )
  }
}

function highlightPost(id: number) {
  document.querySelector(`#p${id} > img`)?.classList.add("arue-favorited-post")
}
