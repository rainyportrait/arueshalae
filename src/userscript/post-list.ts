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
  const encounteredError = van.state(false)

  return () => {
    if (isInFavorites.val) {
      return div(span("In favorites"))
    }

    if (isBeingAdded.val) {
      return div(span("Downloading ..."))
    }

    return div(
      a(
        {
          href: `javascript:void()`,
          onclick: async () => {
            isBeingAdded.val = true
            try {
              const parsedId = Number.parseInt(id)
              if (!(await fetchFilteredId(parsedId))) return
              await syncSingle(parsedId)

              unsafeWindow.post_vote(id, "up")
              unsafeWindow.addFav(id)

              highlightPost(parsedId)

              isInFavorites.val = true
            } catch (error: unknown) {
              console.error(`Failed to add ${id} to favorites:`, error)
              encounteredError.val = true
            } finally {
              isBeingAdded.val = false
            }
          },
          style: () => (encounteredError.val ? "color: red;" : ""),
        },
        () => (!encounteredError.val ? "Add to favorites" : "Failed to add to favorites (retry)"),
      ),
    )
  }
}

function highlightPost(id: number) {
  document.querySelector(`#p${id} > img`)?.classList.add("arue-favorited-post")
}
