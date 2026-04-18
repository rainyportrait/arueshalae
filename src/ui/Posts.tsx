import { useState, useEffect } from "preact/hooks"
import { useSearchParams } from "wouter-preact"
import { navigate } from "wouter-preact/use-browser-location"
import { Link } from "./router"
import { getPostList, PostInfo, type PostListResult, type PageLink } from "./api/posts"
import { Pagination } from "./api/Pagination"

export function Posts() {
	const [params, setParams] = useSearchParams()
	const query = params.get("query") ?? ""
	const pid = Number(params.get("pid") ?? "0")

	const [posts, setPosts] = useState<PostInfo[]>([])
	const [nextPid, setNextPid] = useState<number | undefined>(undefined)
	const [lastPid, setLastPid] = useState<number | undefined>(undefined)
	const [currentPage, setCurrentPage] = useState<number | undefined>(undefined)
	const [pageLinks, setPageLinks] = useState<PageLink[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		async function fetchPosts() {
			try {
				setLoading(true)
				const data = await getPostList(query, pid || undefined)
				setPosts(data.posts)
				setNextPid(data.nextPid)
				setLastPid(data.lastPid)
				setCurrentPage(data.currentPage)
				setPageLinks(data.pageLinks)
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to fetch posts")
			} finally {
				setLoading(false)
			}
		}

		fetchPosts()
	}, [query, pid])

	if (loading) {
		return <div class="p-4">Loading posts...</div>
	}

	if (error) {
		return <div class="p-4 text-red-500">Error: {error}</div>
	}

	return (
		<div class="p-4">
			<div class="mb-6">
				<h2 class="text-2xl font-bold mb-4">Posts</h2>
				<form
					onSubmit={(e) => {
						e.preventDefault()
						navigate(query ? `/posts?query=${query}` : `/posts`)
					}}
					class="arue-search-form"
				>
					<input
						type="text"
						value={query}
						onChange={(e) => {
							setParams({ query: (e.target as HTMLInputElement).value })
						}}
						onBlur={(e) => {
							e.preventDefault()
							const value = (e.target as HTMLInputElement).value
							navigate(value ? `/posts?query=${value}` : `/posts`)
						}}
						placeholder="Search tags..."
						class="arue-search"
					/>
					<button type="submit" class="arue-btn">
						Search
					</button>
				</form>
			</div>
		<div class="columns-2 sm:columns-3 xl:columns-5 gap-4 space-y-4">
			{posts.map((post) => (
				<Link key={post.id} href={`/post/${post.id}`} className="block break-inside-avoid">
					<div class="rounded-md overflow-hidden shadow hover:shadow-lg transition-shadow">
						<img
							src={post.imageUrl}
							alt={`Post ${post.id}`}
							class="w-full h-auto object-cover"
							loading="lazy"
						/>
					</div>
				</Link>
			))}
		</div>
		<Pagination currentPage={currentPage} pageLinks={pageLinks} nextPid={nextPid} lastPid={lastPid} query={query} />
		</div>
	)
}
