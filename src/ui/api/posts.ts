import { fetchDocument } from "./network"

export interface Tag {
	name: string
	kind: TagKind
}

export type TagKind = "copyright" | "character" | "artist" | "general" | "metadata"

export interface PostInfo {
	id: number
	imageUrl: string
	tags: Tag[]
}

export interface PostData extends PostInfo {
	previewUrl?: string
}

// Fetch a page of posts from the post list
// tags should be the raw tag string (e.g., "all" or "foo_bar_baz")
export async function getPostList(tags?: string, pid?: number): Promise<PostInfo[]> {
	const url = `/index.php?page=post&s=list&${tags ? `&tags=${tags}` : ""}${pid ? `&pid=${pid}` : ""}`
	const doc = await fetchDocument(url)
	return extractPostList(doc)
}

// Extract posts from a post list page
function extractPostList(doc: Document): PostInfo[] {
	return Array.from(doc.querySelectorAll(".thumb > a")).map((a) => {
		const id = a.id.substring(1)
		const img = a.querySelector("img")
		return {
			id: Number.parseInt(id, 10),
			imageUrl: img?.getAttribute("data-src") ?? img?.getAttribute("src") ?? "",
			tags: [], // Tags not shown in list view
		}
	})
}
