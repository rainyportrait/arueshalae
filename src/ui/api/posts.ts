import { fetchDocument } from "./network"
import type { PostData, PostInfo, Tag } from "./post"
export type { PostInfo}

// Fetch a page of posts from the post list
// tags should be the raw tag string (e.g., "all" or "foo_bar_baz")
export async function getPostList(tags?: string, pid?: number): Promise<{ posts: PostInfo[]; nextPid?: number }> {
	const url = `/index.php?page=post&s=list&${tags ? `&tags=${tags}` : ""}${pid ? `&pid=${pid}` : ""}`
	const doc = await fetchDocument(url)
	return extractPostList(doc)
}

export interface PostListResult {
	posts: PostInfo[]
	nextPid?: number
}

// Extract posts and pagination from a post list page
function extractPostList(doc: Document): PostListResult {
	const posts = Array.from(doc.querySelectorAll(".thumb > a")).map((a) => {
		const id = a.id.substring(1)
		const img = a.querySelector("img")
		return {
			id: Number.parseInt(id, 10),
			imageUrl: img?.getAttribute("data-src") ?? img?.getAttribute("src") ?? "",
			tags: [], // Tags not shown in list view
		}
	})

	// Extract next page pid from pagination
	const pagination = doc.querySelector(".pagination")
	let nextPid: number | undefined
	if (pagination) {
		const nextLink = pagination.querySelector("a[alt='next']")
		if (nextLink) {
			const href = nextLink.getAttribute("href")
			if (href) {
				const match = href.match(/pid=(\d+)/)
				if (match) {
					nextPid = Number.parseInt(match[1], 10)
				}
			}
		}
	}

	return { posts, nextPid }
}
