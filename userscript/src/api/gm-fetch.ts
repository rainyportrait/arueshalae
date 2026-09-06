// Cross-origin media download via GM.xmlHttpRequest.
//
// The media files (wimg.rule34.xxx, aws-mp4.rule34.xxx) send no CORS headers,
// so a plain fetch from the page can't read them. GM.xmlHttpRequest is
// exempt: the userscript manager performs the request with its own
// privileges and hands the body back.
//
// Uses the portable subset from the compatibility reference at the repo root:
// the Promise form and the `timeout` detail are supported by both
// Violentmonkey and Userscripts for Safari, so no manual timer is needed. The
// response comes back as a Blob — Violentmonkey's "arraybuffer" delivery
// stalls on real media (the network completes while the callback never
// fires) — and is converted with Blob.arrayBuffer().
export async function gmFetchArrayBuffer(url: string, timeoutMs: number): Promise<ArrayBuffer> {
    let response: GMXmlHttpRequestResponse<"blob">
    try {
        response = await GM.xmlHttpRequest({
            url,
            method: "GET",
            responseType: "blob",
            timeout: timeoutMs,
        })
    } catch (error) {
        throw new Error(
            `the media download failed: ${error instanceof Error ? error.message : String(error)}`,
        )
    }
    if (response.status < 200 || response.status >= 300)
        throw new Error(`the download answered HTTP ${response.status}`)
    if (!response.response) throw new Error("the media download failed")
    return response.response.arrayBuffer()
}
