import { State } from "vanjs-core"
import { fetchImage, fetchDocument, filterForNotDownloaded, upload, filterForDownloadedIds } from "./network"

// Syncs
export type SyncProgress =
	| { state: "none" }
	| {
			state: "downloading"
			downloaded: number
			goal: number
	  }
	| {
			state: "done"
			message: string
	  }

export async function sync(
	userId: number,
	totalFavorites: number,
	serverFavorites: number,
	progressState: State<SyncProgress>,
) {
	let downloaded = 0
	const difference = totalFavorites - serverFavorites
	progressState.val = { state: "downloading", downloaded, goal: difference }

	// FIXME: change approach to go backwards until it found the missing
	// Current fix is to load at least 10 pages to check if anything has been missed
	let pid = Math.max(difference, 500)

	do {
		pid = Math.max(0, pid - 50)

		const favoritesPage = await getFavoritesPage(userId, pid)
		const postIds = await filterForNotDownloaded(getPostIds(favoritesPage))
		postIds.reverse()

		for (let postId of postIds) {
			const data = await getPostData(postId)
			await upload(data)
			progressState.val = { state: "downloading", downloaded: ++downloaded, goal: difference }
		}
	} while (pid > 0)

	progressState.val = { state: "done", message: `Synced ${downloaded} posts.` }
}

export async function fullSync(userId: number, totalFavorites: number, progressState: State<SyncProgress>) {
	let downloaded = 0
	progressState.val = { state: "downloading", downloaded, goal: totalFavorites }

	let pid = totalFavorites
	do {
		pid = Math.max(0, pid - 50)

		const favoritesPage = await getFavoritesPage(userId, pid)
		const postIds = getPostIds(favoritesPage)
		postIds.reverse()
		const alreadyDownloaded = await filterForDownloadedIds(postIds)

		for (let postId of postIds) {
			if (alreadyDownloaded.includes(postId)) {
				progressState.val = { state: "downloading", downloaded: ++downloaded, goal: totalFavorites }
				continue
			}

			const data = await getPostData(postId)
			await upload(data)
			progressState.val = { state: "downloading", downloaded: ++downloaded, goal: totalFavorites }
		}
	} while (pid > 0)

	progressState.val = { state: "done", message: `Synced ${downloaded} favorites.` }
}

export async function syncSingle(postId: number) {
	const data = await getPostData(postId)
	await upload(data)
}

// Fetch info
export function getUserId() {
	const id = new URLSearchParams(location.search).get("id")
	if (!id) throw new Error("Could not get user id")
	return Number.parseInt(id, 10)
}

export async function getUserFavoritesCount(userId: number) {
	const profileDOM = await fetchDocument(`https://rule34.xxx/index.php?page=account&s=profile&id=${userId}`)
	const favoritesCountString = profileDOM.querySelector(
		`a[href="index.php?page=favorites&s=view&id=${userId}"]`,
	)?.textContent
	if (!favoritesCountString) throw new Error(`Could not get user favorite count for ${userId}`)
	return Number.parseInt(favoritesCountString, 10) + 1
}

// Single favorites page processing
export function getPostIds(favoritesPage: Document): number[] {
	return Array.from(favoritesPage.querySelectorAll(".thumb > a")).map((a) => Number.parseInt(a.id.substring(1), 10))
}

function getFavoritesPage(userId: number, pid: number) {
	return fetchDocument(`https://rule34.xxx/index.php?page=favorites&s=view&id=${userId}&pid=${pid}`)
}

// Single post processing
export interface PostData {
	id: number
	image: Blob
	tags: Tag[]
}

export interface PostInfo {
	id: number
	imageUrl: string
	tags: Tag[]
}

const TAG_KINDS_ARRAY = ["copyright", "character", "artist", "general", "metadata"] as const
export type TagKind = (typeof TAG_KINDS_ARRAY)[number]
const TAG_KINDS = new Set<TagKind>(TAG_KINDS_ARRAY)
function isTagKind(str: string): str is TagKind {
	return TAG_KINDS.has(str as TagKind)
}

export interface Tag {
	name: string
	kind: TagKind
}

export async function getPostData(postId: number, fetchBlob: true): Promise<PostData>
export async function getPostData(postId: number, fetchBlob: false): Promise<PostInfo>
export async function getPostData(postId: number, fetchBlob: boolean = true): Promise<PostData | PostInfo> {
	const postDOM = await fetchDocument(`/index.php?page=post&s=view&id=${postId}`)
	const tags = getImageTags(postDOM)
	const imageUrl = getImageUrl(postDOM)

	if (fetchBlob) {
		return {
			id: postId,
			image: await fetchImage(imageUrl),
			tags,
		}
	} else {
		return {
			id: postId,
			imageUrl,
			tags,
		}
	}
}

function getImageUrl(postDOM: Document): string {
	const listElements = postDOM.querySelector(".link-list")?.querySelectorAll("li a")
	if (!listElements) throw new Error("Could not find link list")
	const url = Array.from(listElements)
		.find((a) => (a.textContent ?? "").trim() === "Original image")
		?.getAttribute("href")
	if (!url) throw new Error("Could not find original image link")
	return url
}

const TAG_KIND_CLASS = "tag-type-"
function tagFilter(tag: { name: string; kind: string | undefined }): tag is Tag {
	return Boolean(tag.name && tag.kind && isTagKind(tag.kind))
}

function getImageTags(postDOM: Document): Tag[] {
	return Array.from(postDOM.querySelectorAll(".tag"))
		.map((tagElement) => {
			const name =
				tagElement
					.querySelector('a[href*="index.php?page=post&s=list&tags"]')
					?.textContent?.trim()
					.replaceAll(" ", "_") ?? ""
			const kind = Array.from(tagElement.classList)
				.find((c) => c.startsWith(TAG_KIND_CLASS))
				?.substring(TAG_KIND_CLASS.length)
			return { name, kind }
		})
		.filter(tagFilter)
		.filter((t, index, array) => index === array.findIndex((t2) => t.name === t2.name))
}
