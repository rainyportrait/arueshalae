import van from "vanjs-core"
import { checkIfDownloaded } from "./network"
import { FavoriteButton } from "./post-list"

const { ul, li, h6 } = van.tags

export async function post(postId: number) {
	const tagSearchDiv = document.querySelector(".tag-search")
	if (!tagSearchDiv) return

	const container = ul()
	tagSearchDiv.after(container)

	const isFavorited = !(await checkIfDownloaded(postId))

	van.add(container, ArueshalaeOptions(postId, isFavorited))
}

function ArueshalaeOptions(id: number, isFavorited: boolean) {
	return [li(h6("Arueshalae")), li(FavoriteButton(id.toString(), isFavorited))]
}
