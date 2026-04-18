import { fetchDocument, fetchImage } from "./network"

const TAG_KINDS_ARRAY = ["copyright", "character", "artist", "general", "metadata"] as const
export type TagKind = (typeof TAG_KINDS_ARRAY)[number]
const TAG_KINDS = new Set<TagKind>(TAG_KINDS_ARRAY)
function isTagKind(str: string): str is TagKind {
	return TAG_KINDS.has(str as TagKind)
}
const TAG_KIND_CLASS = "tag-type-"

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"]
const VIDEO_EXTENSIONS = ["mp4", "webm", "ogg", "mov", "avi", "mkv", "flv"]

export function getMediaType(url: string): "image" | "video" | undefined {
	try {
		const { pathname } = new URL(url)
		const filename = pathname.split("/").pop()

		if (!filename) return

		const lastDotIndex = filename.lastIndexOf(".")
		if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) return

		const extension = filename.slice(lastDotIndex + 1).toLowerCase()

		if (IMAGE_EXTENSIONS.includes(extension)) return "image"
		if (VIDEO_EXTENSIONS.includes(extension)) return "video"
	} catch (e) {
		console.error("Invalid URL:", url, e)
	}
}

export interface PostInfo {
	id: number
	imageUrl: string
	tags: Tag[]
}

export interface PostData extends PostInfo {
	image: Blob
}

export type MediaType = "image" | "video" | undefined

export interface Tag {
	name: string
	kind: TagKind
}

// Fetch a single post's details
export async function getPostData(postId: number, fetchBlob: true): Promise<PostData>
export async function getPostData(postId: number, fetchBlob: false): Promise<PostInfo>
export async function getPostData(postId: number, fetchBlob: boolean = true): Promise<PostData | PostInfo> {
	const postDOM = await fetchDocument(`/index.php?page=post&s=view&id=${postId}`)
	const tags = getImageTags(postDOM)
	const imageUrl = getImageUrl(postDOM)

	if (fetchBlob) {
		return {
			id: postId,
			imageUrl,
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

function getImageTags(postDOM: Document): Tag[] {
	return Array.from(postDOM.querySelectorAll(".tag"))
		.map((tagElement) => {
			const name =
				tagElement
					.querySelector('a[href*="index.php?page=post&s=list&tags"]')
					?.textContent?.trim()
					.replaceAll(" ", "_") ?? ""

			const kindClass = Array.from(tagElement.classList).find((c) => c.startsWith(TAG_KIND_CLASS))
			const kind = kindClass?.replace(TAG_KIND_CLASS, "") as TagKind | undefined

			return { name, kind }
		})
		.filter(tagFilter)
}

function tagFilter(tag: { name: string; kind: string | undefined }): tag is Tag {
	return Boolean(tag.name && tag.kind && isTagKind(tag.kind))
}
