import van from "vanjs-core"
import { fullSync, getUserFavoritesCount, getUserId, sync, SyncProgress } from "../sync"
import { getDownloadedCount } from "../network"
import { FavoritesSearch } from "./FavoritesSearch"

const { div, span, button } = van.tags

export function FavoritesBar() {
	const userId = van.state<number>(getUserId())
	const favoritesCount = van.state<number | null>(null)
	const serverFavoritesCount = van.state<number | null>(null)

	;(async () => {
		const [fav, ser] = await Promise.all([getUserFavoritesCount(userId.val), await getDownloadedCount()])
		favoritesCount.val = fav
		serverFavoritesCount.val = ser
	})()

	const difference = van.derive(() => {
		if (favoritesCount.val === null || serverFavoritesCount.val === null) return
		return Math.max(favoritesCount.val - serverFavoritesCount.val, 0)
	})

	const syncProgress = van.state<SyncProgress>({ state: "none" })

	return div(
		{ class: "arue-container" },
		div(
			span("Arueshalae"),
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
			() => (syncProgress.val.state !== "none" ? SyncProgress(syncProgress.val) : ""),
		),
		div(FavoritesSearch()),
		div(),
	)
}

export function SyncProgress(syncProgress: SyncProgress) {
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
