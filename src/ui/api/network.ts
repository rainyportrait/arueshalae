// Network layer for fetching data from rule34.xxx
// Uses GM.xmlHttpRequest for CORS-bypassing image fetches

export async function fetchDocument(url: string): Promise<Document> {
	const response = await fetch(url)
	if (response.status !== 200) {
		throw new Error(`${url} returned status ${response.status}`)
	}
	const body = await response.text()
	return new DOMParser().parseFromString(body, "text/html")
}

export async function fetchImage(url: string): Promise<Blob> {
	return new Promise((resolve, reject) => {
		// Use GM.xmlHttpRequest to bypass CORS restrictions
		// GM API is injected by userscript engine, TypeScript doesn't know about it
		const gmOptions: any = {
			url,
			method: "GET",
			responseType: "blob",
			onload: (result: any) => {
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
			// Exponential backoff with jitter
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
