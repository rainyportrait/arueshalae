import { PostData } from "./downloader"

const ARUESHALAE_API_URL = "http://localhost:34343"

const MAX_RETRIES = 5
const JITTER_MS = 30
const BASE_DELAY = 100
const FAIL_INCREASE = 2
const SUCCESS_DECREASE = 0.9
const SUCCESS_STREAK = 5

let currentDelay = BASE_DELAY
let currentStreak = 0

export function fetchDocument(url: string): Promise<Document> {
	return retry(url, baseFetchDocument)
}

export function fetchImage(url: string): Promise<Blob> {
	return retry(url, baseFetchImage)
}

export async function upload(post: PostData) {
	const formData = new FormData()
	formData.append("id", post.id.toString())
	formData.append("image", post.image)
	formData.append("tags", JSON.stringify(post.tags))

	const response = await fetch(`${ARUESHALAE_API_URL}/upload`, {
		method: "POST",
		body: formData,
	})

	if (response.status !== 200) {
		throw new Error(`Upload for post #${post.id} did not succeed. Expected status 200, got ${response.status}`)
	}

	return
}

export async function filterForDownloadedIds(ids: number[]): Promise<number[]> {
	const response = await fetch(`${ARUESHALAE_API_URL}/check`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ postIds: ids }),
	})
	return (await response.json()).postIds
}

export async function filterForNotDownloaded(ids: number[]): Promise<number[]> {
	const downloadedIds = await filterForDownloadedIds(ids)
	return ids.filter(id => !downloadedIds.includes(id))
}

export async function checkIfDownloaded(id: number): Promise<number | null> {
	const idArray = await filterForNotDownloaded([id])
	return idArray.length ? idArray[0] : null
}

export async function getDownloadedCount(): Promise<number> {
	const response = await fetch(`${ARUESHALAE_API_URL}/count`)
	return (await response.json()).count
}

async function baseFetchDocument(url: string): Promise<Document> {
	const response = await fetch(url)
	if (response.status !== 200) {
		throw new Error(`${url} returned status ${response.status}`)
	}
	const body = await response.text()
	return new DOMParser().parseFromString(body, "text/html")
}

async function baseFetchImage(url: string): Promise<Blob> {
	const response = await GM.xmlHttpRequest({ url, method: "GET", responseType: "blob" })
	if (response.status !== 200) {
		throw new Error(`${url} returned status ${response.status}`)
	}
	return response.response
}

export async function retry(url: string, fetch: (url: string) => Promise<Blob>): Promise<Blob>
export async function retry(url: string, fetch: (url: string) => Promise<Document>): Promise<Document>
export async function retry(url: string, fetch: (url: string) => Promise<Document | Blob>): Promise<Document | Blob> {
	await delay()

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const response = await fetch(url)
			currentStreak++
			if (currentStreak === SUCCESS_STREAK) {
				currentStreak = 0
				currentDelay *= SUCCESS_DECREASE
			}
			return response
		} catch {}
		currentStreak = 0
		currentDelay *= FAIL_INCREASE
		await delay()
	}
	throw new Error("Exceeded MAX_RETRIES")
}

async function delay(): Promise<void> {
	const jitter = Math.floor(Math.random() * JITTER_MS)
	await sleep(currentDelay + jitter)
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}
