// Minimal, portable typing for GM.xmlHttpRequest, covering the two target
// managers: Violentmonkey and Userscripts for Safari (quoid/userscripts).
// The shape follows the compatibility reference at the repo root ("GM.
// xmlHttpRequest — Violentmonkey - Userscripts compatibility reference.md"):
// the portable subset both managers implement, nothing more.
declare global {
    type GMResponseType = "text" | "json" | "blob" | "arraybuffer" | "document"

    type GMResponseBody<T extends GMResponseType> = T extends "json"
        ? unknown
        : T extends "blob"
          ? Blob
          : T extends "arraybuffer"
            ? ArrayBuffer
            : T extends "document"
              ? Document
              : string

    interface GMXmlHttpRequestResponse<T extends GMResponseType = "text"> {
        readyState: number
        status: number
        statusText: string
        responseHeaders: string
        response: GMResponseBody<T> | null
        responseText?: T extends "text" ? string : never
    }

    interface GMXmlHttpRequestProgress {
        lengthComputable: boolean
        loaded: number
        total: number
    }

    interface GMXmlHttpRequestDetails<T extends GMResponseType = "text"> {
        url: string
        method?: string
        headers?: Record<string, string>
        data?: Parameters<XMLHttpRequest["send"]>[0]
        user?: string
        password?: string
        overrideMimeType?: string
        timeout?: number
        responseType?: T

        onabort?: (response: GMXmlHttpRequestResponse<T>) => void
        onerror?: (response: GMXmlHttpRequestResponse<T>) => void
        onload?: (response: GMXmlHttpRequestResponse<T>) => void
        onloadend?: (response: GMXmlHttpRequestResponse<T>) => void
        onloadstart?: (response: GMXmlHttpRequestResponse<T>) => void
        onprogress?: (response: GMXmlHttpRequestResponse<T>) => void
        onreadystatechange?: (response: GMXmlHttpRequestResponse<T>) => void
        ontimeout?: (response: GMXmlHttpRequestResponse<T>) => void

        upload?: {
            onabort?: (progress: GMXmlHttpRequestProgress) => void
            onerror?: (progress: GMXmlHttpRequestProgress) => void
            onload?: (progress: GMXmlHttpRequestProgress) => void
            onloadend?: (progress: GMXmlHttpRequestProgress) => void
            onloadstart?: (progress: GMXmlHttpRequestProgress) => void
            onprogress?: (progress: GMXmlHttpRequestProgress) => void
            ontimeout?: (progress: GMXmlHttpRequestProgress) => void
        }
    }

    interface GMXmlHttpRequestPromise<T> extends Promise<T> {
        abort(): void
    }

    interface GMApi {
        xmlHttpRequest<T extends GMResponseType = "text">(
            details: GMXmlHttpRequestDetails<T>,
        ): GMXmlHttpRequestPromise<GMXmlHttpRequestResponse<T>>
    }

    declare const GM: GMApi
}

export {}
