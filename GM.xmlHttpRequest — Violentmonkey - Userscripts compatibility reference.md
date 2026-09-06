# `GM.xmlHttpRequest`

Target userscript managers:

- Violentmonkey
- Userscripts for Safari (`quoid/userscripts`), including iOS

Use the modern `GM.xmlHttpRequest()` API rather than the legacy `GM_xmlhttpRequest()` API.

Violentmonkey has supported the Promise-based form since 2.18.3. Userscripts also implements `GM.xmlHttpRequest()` as a custom Promise with an additional `abort()` method.

## Required metadata

```js
// ==UserScript==
// @grant       GM.xmlHttpRequest
// @inject-into content
// ==/UserScript==
```

Add the normal `@name`, `@match`, etc. separately.

`@inject-into content` should be used for compatibility with Userscripts. Its privileged `GM.*` APIs are only exposed in content-script scope. Violentmonkey also supports `content` injection.

Userscripts does **not** implement `@connect`; support was explicitly closed as not planned. If `@connect` entries are added for another userscript manager, do not rely on them having any effect in Userscripts.

## Basic request

```ts
const response = await GM.xmlHttpRequest({
    method: "GET",
    url: "https://example.com/api",
    responseType: "json",
});

if (response.status < 200 || response.status >= 300) {
    throw new Error(
        `Request failed: ${response.status} ${response.statusText}`,
    );
}

console.log(response.response);
```

Unlike `fetch()`, there is no `Response.ok`, `.json()`, `.text()`, etc. The body is returned directly in `response.response`, according to `responseType`.

Supported portable response types are:

```ts
"text"
"json"
"blob"
"arraybuffer"
"document"
```

If omitted, treat the response as text. Violentmonkey documents these response types, and Userscripts bases its types on `XMLHttpRequestResponseType`.

## Request options

The useful common subset is:

```ts
GM.xmlHttpRequest({
    url: "...",                 // required
    method: "GET",              // optional
    headers: {
        Accept: "application/json",
    },
    data: ...,                  // optional request body
    responseType: "json",       // optional
    timeout: 10_000,            // optional, milliseconds
    user: "...",                // optional HTTP auth
    password: "...",            // optional HTTP auth
    overrideMimeType: "...",    // optional
});
```

Userscripts accepts normal `XMLHttpRequest.send()` body types, including strings, blobs, array buffers, typed arrays, `DataView`, `FormData`, and `URLSearchParams`. Its old `binary` option is deprecated.

## Response

Portable code should rely primarily on:

```ts
response.status
response.statusText
response.readyState
response.responseHeaders
response.response
response.responseText
```

Avoid depending on the redirect/final-URL property if cross-manager portability matters:

- Violentmonkey exposes `finalUrl`.
- Userscripts exposes `responseURL`.

The basic response fields above are shared by both implementations.

## Cancellation

The returned value is both a Promise and an abort handle:

```ts
const request = GM.xmlHttpRequest({
    url: "https://example.com/slow",
});

request.abort();

const response = await request;
```

This is supported by both Violentmonkey and Userscripts.

## TypeScript

If the project can use an npm development dependency, Violentmonkey publishes official declarations:

```sh
npm install --save-dev @violentmonkey/types
```

Then include them from a `.d.ts` file:

```ts
import "@violentmonkey/types";
```

This is the simplest choice when Violentmonkey is the reference API.

For a project that should have no userscript-manager type dependency, the following minimal declarations describe the portable subset needed for HTTP requests:

```ts
type GMResponseType =
    | "text"
    | "json"
    | "blob"
    | "arraybuffer"
    | "document";

type GMResponseBody<T extends GMResponseType> =
    T extends "json" ? unknown
    : T extends "blob" ? Blob
    : T extends "arraybuffer" ? ArrayBuffer
    : T extends "document" ? Document
    : string;

interface GMXmlHttpRequestResponse<
    T extends GMResponseType = "text",
> {
    readyState: number;
    status: number;
    statusText: string;
    responseHeaders: string;
    response: GMResponseBody<T> | null;
    responseText?: T extends "text" ? string : never;
}

interface GMXmlHttpRequestProgress {
    lengthComputable: boolean;
    loaded: number;
    total: number;
}

interface GMXmlHttpRequestDetails<
    T extends GMResponseType = "text",
> {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: Parameters<XMLHttpRequest["send"]>[0];
    user?: string;
    password?: string;
    overrideMimeType?: string;
    timeout?: number;
    responseType?: T;

    onabort?: (response: GMXmlHttpRequestResponse<T>) => void;
    onerror?: (response: GMXmlHttpRequestResponse<T>) => void;
    onload?: (response: GMXmlHttpRequestResponse<T>) => void;
    onloadend?: (response: GMXmlHttpRequestResponse<T>) => void;
    onloadstart?: (response: GMXmlHttpRequestResponse<T>) => void;
    onprogress?: (response: GMXmlHttpRequestResponse<T>) => void;
    onreadystatechange?: (
        response: GMXmlHttpRequestResponse<T>,
    ) => void;
    ontimeout?: (response: GMXmlHttpRequestResponse<T>) => void;

    upload?: {
        onabort?: (progress: GMXmlHttpRequestProgress) => void;
        onerror?: (progress: GMXmlHttpRequestProgress) => void;
        onload?: (progress: GMXmlHttpRequestProgress) => void;
        onloadend?: (progress: GMXmlHttpRequestProgress) => void;
        onloadstart?: (progress: GMXmlHttpRequestProgress) => void;
        onprogress?: (progress: GMXmlHttpRequestProgress) => void;
        ontimeout?: (progress: GMXmlHttpRequestProgress) => void;
    };
}

interface GMXmlHttpRequestPromise<T> extends Promise<T> {
    abort(): void;
}

interface GMApi {
    xmlHttpRequest<T extends GMResponseType = "text">(
        details: GMXmlHttpRequestDetails<T>,
    ): GMXmlHttpRequestPromise<GMXmlHttpRequestResponse<T>>;
}

declare const GM: GMApi;
```

This is intentionally narrower than Violentmonkey's complete API. Do not add manager-specific fields unless they are actually needed.

Userscripts' own current declaration has essentially this signature:

```ts
xmlHttpRequest<T extends XMLHttpRequestResponseType>(
    details: XHRDetails<T>,
): XHRPromise<XHRResponse<T>>;

interface XHRPromise<T> extends Promise<T> {
    abort(): void;
}
```



## Recommended JSON helper

For application code, hide the ugly userscript API behind a small helper:

```ts
export async function getJson<T>(url: string): Promise<T> {
    const response = await GM.xmlHttpRequest({
        method: "GET",
        url,
        responseType: "json",
    });

    if (response.status < 200 || response.status >= 300) {
        throw new Error(
            `GET ${url} failed: ` +
            `${response.status} ${response.statusText}`,
        );
    }

    return response.response as T;
}
```

Similarly, a POST can use standard request bodies:

```ts
export async function postJson<TResponse>(
    url: string,
    body: unknown,
): Promise<TResponse> {
    const response = await GM.xmlHttpRequest({
        method: "POST",
        url,
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        data: JSON.stringify(body),
        responseType: "json",
    });

    if (response.status < 200 || response.status >= 300) {
        throw new Error(
            `POST ${url} failed: ` +
            `${response.status} ${response.statusText}`,
        );
    }

    return response.response as TResponse;
}
```

Prefer Promise/`await` usage rather than the callback handlers unless upload/download progress or some other event is actually required.

Do not attempt to use `GM.fetch`: neither target currently provides it as the production API. Userscripts has an open enhancement issue investigating such an API, but `GM.xmlHttpRequest()` remains the implemented portable interface.