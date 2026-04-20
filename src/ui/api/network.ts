import { solveCaptcha } from "../captcha/index"

async function baseFetchDocument(url: string): Promise<Document> {
	const response = await fetch(url)
	if (response.status >= 400 && response.status < 500) {
		const body = await response.text()
		if (body.toLowerCase().includes("captcha")) {
			console.log("[Network] Captcha detected, awaiting resolution")
			await solveCaptcha(url)
			return baseFetchDocument(url)
		}
	}
	if (response.status !== 200) {
		throw new Error(`${url} returned status ${response.status}`)
	}
	const body = await response.text()
	return new DOMParser().parseFromString(body, "text/html")
}

export async function fetchDocument(url: string): Promise<Document> {
	return retry<Document>(url, async () => baseFetchDocument(url))
}

export async function fetchImage(url: string): Promise<Blob> {
	return retry<Blob>(url, async () => baseFetchImage(url))
}

async function baseFetchImage(url: string): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const gmOptions: any = {
			url,
			method: "GET",
			responseType: "blob",
			onload: async (result: any) => {
				if (result.status >= 400 && result.status < 500) {
					const body = result.responseText || ""
					if (body.toLowerCase().includes("captcha")) {
						console.log("[Network] Captcha detected in image fetch, awaiting resolution")
						await solveCaptcha(url)
						resolve(await baseFetchImage(url))
						return
					}
				}
				if (result.status === 200) {
					resolve(result.response)
				} else {
					reject(new Error(`Image fetch failed: ${result.status}`))
				}
			},
			onerror: (result: any) => {
				reject(result.error || new Error("Network error"))
			},
		}
		GM.xmlHttpRequest(gmOptions)
	})
}

// Retry helper with exponential backoff
export async function retry<T>(
	url: string,
	fetchFn: (url: string) => Promise<T>,
	maxRetries: number = 15,
	baseDelay: number = 100,
): Promise<T> {
	let lastError: Error | null = null

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await fetchFn(url)
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e))
			const jitter = Math.random() * 30
			const delay = baseDelay * Math.pow(2, attempt) + jitter
			await sleep(delay)
		}
	}

	throw lastError ?? new Error("Exceeded max retries")
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
