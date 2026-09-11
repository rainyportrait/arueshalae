import type { PostMedia } from "./api/post-details.ts"
import type { Post } from "./api/post-list.ts"
import { libraryPosts } from "./state/library.ts"
import { serverSettings } from "./state/settings.ts"

type ImageMedia = Extract<PostMedia, { kind: "image" }>
type VideoMedia = Extract<PostMedia, { kind: "video" }>
type LocalMediaKind = "image" | "mini" | "video"

// Whether the local copy of the post's media should be served for this
// purpose. `on` is the purpose-specific preference; a missing one inherits
// the legacy `preferDownloaded` switch stored by older builds, which
// defaulted to enabled when missing too.
function preferLocal(postId: number, on: boolean | undefined): boolean {
    const settings = serverSettings.val
    return (
        settings.enabled &&
        (on ?? settings.preferDownloaded !== false) &&
        settings.url.trim() !== "" &&
        libraryPosts.val.get(postId)?.downloaded === true
    )
}

function localMediaUrl(postId: number, kind: LocalMediaKind): string {
    const base = serverSettings.val.url.trim().replace(/\/+$/, "")
    const query = kind === "image" ? "" : `?type=${kind}`
    return `${base}/api/posts/${postId}/media${query}`
}

export function thumbnailUrl(post: Post): string {
    return preferLocal(post.id, serverSettings.val.serverThumbnails)
        ? localMediaUrl(post.id, "mini")
        : post.thumbnail
}

export function imageUrl(postId: number, media: ImageMedia, original: boolean): string {
    if (preferLocal(postId, serverSettings.val.serverMedia)) return localMediaUrl(postId, "image")
    return original && media.originalImage ? media.originalImage : media.src
}

export function videoUrl(postId: number, media: VideoMedia): string {
    return preferLocal(postId, serverSettings.val.serverMedia)
        ? localMediaUrl(postId, "video")
        : media.src
}

export function videoPosterUrl(postId: number, media: VideoMedia): string {
    return preferLocal(postId, serverSettings.val.serverMedia)
        ? localMediaUrl(postId, "image")
        : media.poster
}
