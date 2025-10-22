import van from "vanjs-core"
import { filterForDownloadedIds } from "./network"
import { FavoriteButton } from "./components/FavoriteButton"
import { highlightPost } from "./post-list"

export async function pool() {
	const favoritedIds = await filterForDownloadedIds(getPoolPostIds())
	for (const id of favoritedIds) {
		highlightPost(id)
	}
	addFavoritesButtons(favoritedIds)
}

function addFavoritesButtons(favoritedIds: number[]) {
	Array.from(document.querySelectorAll(".thumb")).forEach((t) => {
		const id = t.id.substring(1)
		if (!id) return
		van.add(t, FavoriteButton(id, favoritedIds.includes(Number.parseInt(id))))
	})
}

function getPoolPostIds(): number[] {
	return Array.from(document.querySelectorAll(".thumb")).map((a) => Number.parseInt(a.id.substring(1), 10))
}
