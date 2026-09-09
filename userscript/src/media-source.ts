import type { PostMedia } from "./api/post-details.ts"
import type { Post } from "./api/post-list.ts"
import { downloaded } from "./state/downloaded.ts"
import { serverSettings } from "./state/settings.ts"

type ImageMedia = Extract<PostMedia, { kind: "image" }>
type VideoMedia = Extract<PostMedia, { kind: "video" }>
type LocalMediaKind = "image" | "mini" | "video"

function preferLocal(postId: number): boolean {
    const settings = serverSettings.val
    // Treat the missing field in settings saved by older versions as the new
    // default. The next settings write persists it explicitly.
    return (
        settings.enabled &&
        settings.preferDownloaded !== false &&
        settings.url.trim() !== "" &&
        downloaded.val.has(postId)
    )
}

function localMediaUrl(postId: number, kind: LocalMediaKind): string {
    const base = serverSettings.val.url.trim().replace(/\/+$/, "")
    const query = kind === "image" ? "" : `?type=${kind}`
    return `${base}/api/posts/${postId}/media${query}`
}

export function thumbnailUrl(post: Post): string {
    return preferLocal(post.id) ? localMediaUrl(post.id, "mini") : post.thumbnail
}

export function imageUrl(postId: number, media: ImageMedia, original: boolean): string {
    if (preferLocal(postId)) return localMediaUrl(postId, "image")
    return original && media.originalImage ? media.originalImage : media.src
}

export function videoUrl(postId: number, media: VideoMedia): string {
    return preferLocal(postId) ? localMediaUrl(postId, "video") : media.src
}

export function videoPosterUrl(postId: number, media: VideoMedia): string {
    return preferLocal(postId) ? localMediaUrl(postId, "image") : media.poster
}
