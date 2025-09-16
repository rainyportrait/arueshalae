import van from "vanjs-core"
import { checkIfDownloaded, filterForDownloadedIds } from "../network"
import { syncSingle } from "../sync"
import { highlightPost } from "../post-list"

const { div, span, a } = van.tags

export function FavoriteButton(id: string, favorited: boolean, highlightOnFavorite = true) {
	const isInFavorites = van.state(favorited)
	const isBeingAdded = van.state(false)
	const encounteredError = van.state(false)

	const parsedId = Number.parseInt(id)
	if (!favorited) {
		registerFavoriteButton(parsedId, () => {
			isInFavorites.val = true
		})
	}

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
							if (!(await checkIfDownloaded(parsedId))) return
							await syncSingle(parsedId)

							unsafeWindow.post_vote(id, "up")
							unsafeWindow.addFav(id)

							if (highlightOnFavorite) highlightPost(parsedId)

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

let visibilityCallbackRegistered = false
const favoriteButtonCallbacks = new Map<number, () => void>()

function registerFavoriteButton(id: number, gotFavorited: () => void) {
	if (!visibilityCallbackRegistered) {
		document.addEventListener("visibilitychange", () => {
			if (!document.hidden) checkFavoriteState()
		})
		visibilityCallbackRegistered = true
	}
	favoriteButtonCallbacks.set(id, gotFavorited)
}

async function checkFavoriteState() {
	const ids = Array.from(favoriteButtonCallbacks.keys())
	const newFavorites = await filterForDownloadedIds(ids)
	for (let id of newFavorites) {
		favoriteButtonCallbacks.get(id)?.()
		favoriteButtonCallbacks.delete(id)
	}
}
