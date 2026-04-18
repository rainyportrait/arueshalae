import { fetchDocument } from "./network"
import type { PostData, PostInfo, Tag } from "./post"
export type { PostInfo}

// Fetch a page of posts from the post list
// tags should be the raw tag string (e.g., "all" or "foo_bar_baz")
export async function getPostList(tags?: string, pid?: number): Promise<PostListResult> {
	const url = `/index.php?page=post&s=list&${tags ? `&tags=${tags}` : ""}${pid ? `&pid=${pid}` : ""}`
	const doc = await fetchDocument(url)
	return extractPostList(doc)
}

export interface PostListResult {
	posts: PostInfo[]
	nextPid?: number
	lastPid?: number
	currentPage?: number
	pageLinks: PageLink[]
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

	// Extract pagination
	const pagination = doc.querySelector(".pagination")
	let nextPid: number | undefined
	let lastPid: number | undefined
	let currentPage: number | undefined
	const pageLinks: PageLink[] = []

	if (pagination) {
		// Extract all page links
		const links = Array.from(pagination.querySelectorAll("a"))
		for (const link of links) {
			const href = link.getAttribute("href")
			const alt = link.getAttribute("alt")
			const text = link.textContent?.trim()

			if (href) {
				const match = href.match(/pid=(\d+)/)
				if (match) {
					const pid = Number.parseInt(match[1], 10)
					if (alt === "next") {
						nextPid = pid
					} else if (alt === "last page") {
						lastPid = pid
					}
					if (text) {
						pageLinks.push({ page: Number(text), pid })
					}
				}
			}
		}

		// Find current page (the one in <b> tag or in the current URL)
		const currentPageEl = pagination.querySelector("b")
		if (currentPageEl) {
			currentPage = Number.parseInt(currentPageEl.textContent ?? "1", 10)
		}
	}

	return { posts, nextPid, lastPid, currentPage, pageLinks }
}

export interface PageLink {
	page: number
	pid: number
}
