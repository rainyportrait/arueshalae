import { useState, useEffect } from "preact/hooks"
import { useRoute } from "wouter-preact"
import { Link } from "./router"
import { getPostData, PostInfo, getMediaType, MediaType } from "./api/post"

export function Post() {
	const [match, params] = useRoute("/post/:id")
	const id = Number(params?.id)

	const [post, setPost] = useState<PostInfo | null>(null)
	const [mediaType, setMediaType] = useState<MediaType>(undefined)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		async function fetchPost() {
			try {
				setLoading(true)
				const data = await getPostData(id, false)
				setPost(data)
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to fetch post")
			} finally {
				setLoading(false)
			}
		}

		if (match && id) {
			fetchPost()
		}
	}, [match, id])

	useEffect(() => {
		if (post?.imageUrl) {
			setMediaType(getMediaType(post.imageUrl))
		}
	}, [post])

	if (!match) {
		return null
	}

	if (loading) {
		return <div class="p-4">Loading post...</div>
	}

	if (error) {
		return <div class="p-4 text-red-500">Error: {error}</div>
	}

	if (!post) {
		return <div class="p-4">Post not found</div>
	}

	return (
		<div class="p-4">
			<div class="grid grid-cols-1 md:grid-cols-4 gap-8">
				<div class="md:col-span-1">
					<div class="bg-gray-100 rounded-md p-4">
						<h2 class="text-xl font-semibold mb-2">Tags</h2>
						<div class="flex flex-wrap gap-2">
							{post.tags.map((tag) => (
								<Link
									key={tag.name}
									href={`/posts?query=${tag.name}`}
									className={`px-3 py-1 rounded-full text-sm cursor-pointer hover:opacity-80 ${
										tag.kind === "copyright"
											? "bg-purple-100 text-purple-800"
											: tag.kind === "character"
												? "bg-green-100 text-green-800"
												: tag.kind === "artist"
													? "bg-blue-100 text-blue-800"
													: tag.kind === "general"
														? "bg-yellow-100 text-yellow-800"
														: "bg-gray-100 text-gray-800"
									}`}
								>
									<>{tag.name}</>
								</Link>
							))}
						</div>
					</div>
				</div>
				<div class="md:col-span-3">
					{mediaType === "video" ? (
						<video
							autoplay
							muted
							loop
							controls
							class="w-full h-auto rounded-md shadow-lg"
							src={post.imageUrl}
						/>
					) : (
						<img src={post.imageUrl} alt={`Post ${post.id}`} class="w-full h-auto rounded-md shadow-lg" />
					)}
				</div>
			</div>
		</div>
	)
}
