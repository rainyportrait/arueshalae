import van, { State } from "vanjs-core"
import { getPostElementsFromPostList } from "./post-list"
import { getPostData, Tag } from "./sync"
import { FavoriteButton } from "./components/FavoriteButton"

const { div, img, video, a } = van.tags

interface GalleryPost {
	id: number
	isInFavorites: boolean
	previewUrl: string
	sourceUrl?: string
	tags?: Tag[]
}

const posts = new Map<number, State<GalleryPost>>()
const activePostId = van.state<number | null>(null)

export function initGallery(favoriteIds: number[]) {
	getPostElementsFromPostList()
		.map((el) => ({ id: +el.querySelector("a")!.id.substring(1), el: el.querySelector("img") as HTMLImageElement }))
		.forEach(({ id, el }) => {
			const post = van.state({
				id,
				isInFavorites: favoriteIds.includes(id),
				previewUrl: el.src,
			})
			posts.set(id, post)

			el.addEventListener("contextmenu", (event: MouseEvent) => {
				event.preventDefault()
				activePostId.val = id
			})
		})

	van.add(document.body, Gallery)
}

export async function fetchImageDetails(id: number) {
	const data = await getPostData(id, false)
	const post = posts.get(id)!
	post.val = { ...post.val, sourceUrl: data.imageUrl, tags: data.tags }
}

function Gallery() {
	van.derive(() => {
		const id = activePostId.val
		if (id) {
			queueMicrotask(() => {
				const previewImg = document.getElementById(`arue-gallery-preview-image-${id}`)
				previewImg?.scrollIntoView({
					behavior: "smooth",
					block: "center",
					inline: "center",
				})
			})
		}
	})

	return div(
		{
			class: () => (activePostId.val ? "arue-dialog-backdrop" : "arue-hidden"),
			onclick: function (e) {
				if (e.target === this) activePostId.val = null
			},
			oncontextmenu: function (e) {
				e.preventDefault()
				activePostId.val = null
			},
		},
		div(
			{ class: "arue-gallery" },
			div(
				{ class: "arue-gallery-active-container" },
				() =>
					div(
						{
							class: "arue-gallery-active-image-container",
							onclick: (e: MouseEvent) => {
								const target = e.target as HTMLElement
								const rect = target.getBoundingClientRect()
								const clickX = e.clientX - rect.left
								const width = rect.width

								if (clickX < width / 2) {
									goToPreviousImage()
								} else {
									goToNextImage()
								}
							},
						},
						ActiveImage,
					),
				() => div({ class: "arue-gallery-controls" }, ActiveImageControls()),
			),
			() => PreviewGallery(),
		),
	)
}

function ActiveImageControls() {
	const activePost = posts.get(activePostId.val!)
	if (!activePost) return div()

	const currentSearchTerm = new URL(location.href).searchParams.get("tags") ?? ""

	return div(
		FavoriteButton(activePost.val.id.toString(), activePost.val.isInFavorites, true, () => {
			activePost.val = { ...activePost.val, isInFavorites: true }
		}),
		a(
			{ href: `/index.php?page=post&s=view&id=${activePost.val.id}&tags=${currentSearchTerm}`, target: "_blank" },
			"Go to full post",
		),
	)
}

function ActiveImage() {
	const activePost = posts.get(activePostId.val!)
	if (!activePost?.val.sourceUrl) {
		if (activePost) fetchImageDetails(activePost.val.id)
		return div()
	}

	const mediaType = getMediaType(activePost.val.sourceUrl)
	if (!mediaType) return div(`Cannot determine media type for ${activePost.val.id}`)
	if (mediaType === "image") {
		return img({
			class: "arue-gallery-active-image",
			src: activePost?.val.sourceUrl ?? "",
		})
	} else {
		return video({
			class: "arue-gallery-active-image",
			controls: true,
			autoplay: true,
			muted: true,
			loop: true,
			poster: activePost.val.previewUrl,
			src: activePost.val.sourceUrl,
		})
	}
}

function PreviewGallery() {
	const container = div({ class: "arue-gallery-preview-container" })

	Array.from(posts).forEach(([id, post]) => {
		const image = () =>
			img({
				src: post.val.previewUrl,
				id: `arue-gallery-preview-image-${post.val.id}`,
				class: `arue-gallery-preview-image ${post.val.isInFavorites ? "arue-favorited-post" : ""}`,
				selected: () => activePostId.val === post.val.id,
				onclick: () => {
					activePostId.val = id
				},
			})
		van.add(container, image)
	})

	return container
}

function goToNextImage() {
	if (posts.size === 0) return

	const postIds = Array.from(posts.keys())
	const currentId = activePostId.val

	if (currentId === null) {
		activePostId.val = postIds[0]
		return
	}

	const currentIndex = postIds.indexOf(currentId)
	const nextIndex = (currentIndex + 1) % postIds.length
	activePostId.val = postIds[nextIndex]
}

function goToPreviousImage() {
	if (posts.size === 0) return

	const postIds = Array.from(posts.keys())
	const currentId = activePostId.val

	if (currentId === null) {
		activePostId.val = postIds[postIds.length - 1]
		return
	}

	const currentIndex = postIds.indexOf(currentId)
	const previousIndex = (currentIndex - 1 + postIds.length) % postIds.length
	activePostId.val = postIds[previousIndex]
}

function getMediaType(url: string): "image" | "video" | undefined {
	try {
		const { pathname } = new URL(url)
		const filename = pathname.split("/").pop()

		if (!filename) return

		const lastDotIndex = filename.lastIndexOf(".")
		if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) return

		const extension = filename.slice(lastDotIndex + 1).toLowerCase()

		const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"]
		const videoExtensions = ["mp4", "webm", "ogg", "mov", "avi", "mkv", "flv"]

		if (imageExtensions.includes(extension)) return "image"
		if (videoExtensions.includes(extension)) return "video"
	} catch (e) {
		console.error("Invalid URL:", url, e)
	}
}
