const MAX_RETRIES = 5;
const BASE_DELAY = 100;
const BACKOFF_MULTIPLIER = 2;
const RETRY_STATUS = [429, 500, 502, 503, 504];

const parser = new DOMParser();

const supportedTypes: readonly DOMParserSupportedType[] = [
  "application/xml",
  "application/xhtml+xml",
  "text/html",
  "text/xml",
  "image/svg+xml",
] as const;

function isValidDOMParserContentType(
  contentType: string,
): contentType is DOMParserSupportedType {
  return supportedTypes.includes(contentType as DOMParserSupportedType);
}

export async function fetchDocument(url: string): Promise<Document> {
  const response = await getWithRetry(url);
  const body = await response.text();
  const contentType = response.headers
    .get("Content-Type")
    ?.split(";")[0]
    .trim();

  if (!contentType) {
    throw `Did not get Content-Type from ${url}`;
  }

  if (!isValidDOMParserContentType(contentType)) {
    throw `Did not get a valid Document from ${url}`;
  }

  return parser.parseFromString(body, contentType);
}

export function getIdsFromDOM(dom: Document): number[] {
  return Array.from(dom.querySelectorAll(".thumb > a"))
    .map((anchor) => Number.parseInt(anchor.id.substring(1), 10))
    .reverse();
}

async function getWithRetry(url: string): Promise<Response> {
  let attempt = 1;
  while (attempt <= MAX_RETRIES) {
    try {
      const response = await fetch(url);
      if (!RETRY_STATUS.includes(response.status)) {
        return response;
      }
    } catch {}
    await sleep(BASE_DELAY * Math.pow(BACKOFF_MULTIPLIER, attempt - 1));
    attempt++;
  }

  throw "Exceeded MAX_RETRIES";
}

function sleep(timeInMilliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeInMilliseconds);
  });
}
