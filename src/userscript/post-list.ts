import van from "vanjs-core"
import { filterForDownloadedIds } from "./network"
import { getPostIds } from "./sync"
import { FavoriteButton } from "./components/FavoriteButton"
import { initGallery } from "./gallery"

export async function postList() {
	const favoritedIds = await filterForDownloadedIds(getPostIds(document))
	for (const id of favoritedIds) {
		highlightPost(id)
	}
	addFavoritesButtons(favoritedIds)

	initGallery(favoritedIds)
}

function addFavoritesButtons(favoritedIds: number[]) {
	getPostElementsFromPostList().forEach((t) => {
		const id = t.querySelector("a")?.id.substring(1)
		if (!id) return
		van.add(t, FavoriteButton(id, favoritedIds.includes(Number.parseInt(id))))
	})
}

export function getPostElementsFromPostList() {
	return Array.from(document.querySelectorAll(".thumb"))
}

export function highlightPost(id: number) {
	document.querySelector(`#p${id} img`)?.classList.add("arue-favorited-post")
}
