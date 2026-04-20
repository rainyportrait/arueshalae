import { fetchDocument } from "./network"
import type { PostInfo } from "./post"
export type { PostInfo }

// Fetch a page of posts from the post list
// tags should be the raw tag string (e.g., "all" or "foo_bar_baz")
export async function getPostList(tags?: string, pid?: number): Promise<PostListResult> {
	const url = `/index.php?page=post&s=list&${tags ? `&tags=${tags}` : ""}${pid ? `&pid=${pid}` : ""}`
	const doc = await fetchDocument(url)
	return extractPostList(doc, pid)
}

export interface PostListResult {
	posts: PostInfo[]
	nextPid?: number
	currentPage?: number
	isLastPage: boolean
	lastPagePid?: number
}

const POSTS_PER_PAGE = 42

// Extract posts and pagination from a post list page
function extractPostList(doc: Document, currentPid?: number): PostListResult {
	const posts = Array.from(doc.querySelectorAll(".thumb > a")).map((a) => {
		const id = a.id.substring(1)
		const img = a.querySelector("img")
		return {
			id: Number.parseInt(id, 10),
			imageUrl: img?.getAttribute("data-src") ?? img?.getAttribute("src") ?? "",
			tags: [], // Tags not shown in list view
		}
	})

	const postsOnPage = posts.length

	// Calculate page numbers programmatically
	const pidToUse = currentPid ?? 0
	const currentPage = Math.floor(pidToUse / POSTS_PER_PAGE) + 1
	const nextPid = postsOnPage === POSTS_PER_PAGE ? pidToUse + postsOnPage : undefined

	// Get lastPid from HTML to know what the last page is
	let lastPagePid: number | undefined
	const pagination = doc.querySelector(".pagination")
	if (pagination) {
		const lastPageLink = pagination.querySelector("a[alt='last page']")
		if (lastPageLink) {
			const href = lastPageLink.getAttribute("href")
			if (href) {
				const match = href.match(/pid=(\d+)/)
				if (match) {
					lastPagePid = Number.parseInt(match[1], 10)
				}
			}
		}
	}

	// Determine if this is the last page (got fewer than 42 posts)
	const isLastPage = postsOnPage < POSTS_PER_PAGE

	// If we're on the last page and didn't parse a lastPagePid, use current page's pid
	if (isLastPage && lastPagePid === undefined) {
		lastPagePid = pidToUse
	}

	return { posts, nextPid, currentPage, isLastPage, lastPagePid }
}
