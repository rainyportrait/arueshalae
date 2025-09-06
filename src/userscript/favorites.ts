import van from "vanjs-core"
import { fullSync, getUserFavoritesCount, getUserId, sync, SyncProgress } from "./downloader"
import { getDownloadedCount } from "./network"

export async function favorites() {
  improveStyles()

  const header = document.querySelector("#header")
  if (!header) throw new Error("Could not find header")

  van.add(header, ArueFavoritesBar())
}

// Style improvments
function improveStyles() {
  Array.from(document.querySelectorAll(".thumb ~ br")).forEach(br => br.remove())
  Array.from(document.querySelectorAll(".thumb > a")).forEach(e => {
    e.removeAttribute("onclick")
  })
}

const { div, button, a, span } = van.tags

export function ArueFavoritesBar() {
  const userId = van.state<number>(getUserId())
  const favoritesCount = van.state<number | null>(null)
  const serverFavoritesCount = van.state<number | null>(null)

    ; (async () => {
      const [fav, ser] = await Promise.all([getUserFavoritesCount(userId.val), await getDownloadedCount()])
      console.log({ fav, ser })
      favoritesCount.val = fav
      serverFavoritesCount.val = ser
    })()

  const difference = van.derive(() => {
    if (favoritesCount.val === null || serverFavoritesCount.val === null) return
    return favoritesCount.val - serverFavoritesCount.val
  })

  const syncProgress = van.state<SyncProgress>({ state: "none" })

  return div(
    { class: "arue-container" },
    a({ href: "http://localhost:34343/", class: "arue-link" }, `Arueshalae`),
    button(
      {
        class: "arue-btn",
        onclick: () => {
          if (userId.val !== null && favoritesCount.val !== null && serverFavoritesCount.val !== null) {
            sync(userId.val, favoritesCount.val, serverFavoritesCount.val, syncProgress)
          }
        },
        disabled: () => userId.val === null || favoritesCount.val === null || serverFavoritesCount === null,
      },
      "Sync",
      () => (difference.val ? ` (${difference.val})` : ""),
    ),
    button(
      {
        class: "arue-btn",
        onclick: () => {
          if (userId.val !== null && favoritesCount.val !== null) {
            fullSync(userId.val, favoritesCount.val, syncProgress)
          }
        },
        disabled: () => userId.val === null || favoritesCount.val === null,
      },
      "Full Sync",
      () => (favoritesCount.val ? ` (${favoritesCount.val})` : ""),
    ),
    () => (syncProgress.val.state !== "none" ? SyncProgress(favoritesCount.val ?? 0, syncProgress.val) : ""),
  )
}

export function SyncProgress(totalFavoritesCount: number, syncProgress: SyncProgress) {
  return div(span("Sync: "), () => {
    if (syncProgress.state === "downloading") {
      return span(`Downloading (${syncProgress.downloaded}/${syncProgress.goal})`)
    }
    if (syncProgress.state === "done") {
      return span(syncProgress.message)
    }
    return ""
  })
}
