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
  const response = await fetch(url);
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
