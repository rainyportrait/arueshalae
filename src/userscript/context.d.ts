// rule34.xxx public functions
interface Window {
  post_vote: (id: string, kind: string) => void
  addFav: (id: string) => void
}

// Greasemonkey GM.xmlHttpRequest
declare namespace GM {
  interface Response {
    readonly responseHeaders: string
    readonly response: Blob
    readonly status: number
  }

  interface Request {
    url: string
    method: "GET"
    responseType: "blob"
  }
}

declare var unsafeWindow: Window

declare var GM: {
  xmlHttpRequest(details: GM.Request): Promise<GM.Response>
}
