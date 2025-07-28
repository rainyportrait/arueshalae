const BASE_URL = "http://localhost:34343";

export async function sendPostIds(postIds: number[]): Promise<undefined> {
  const url = `${BASE_URL}/api/post`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ postIds }),
  });
  if (response.status !== 200) {
    throw "API did not accept posts";
  }
}

export async function getApiPostCount(): Promise<number> {
  const url = `${BASE_URL}/api/post`;
  const response = await fetch(url);
  const json: unknown = await response.json();
  if (
    !(
      json &&
      typeof json === "object" &&
      "count" in json &&
      typeof json.count === "number"
    )
  ) {
    throw "Did get unexpected response from /api/post: missing or non-number count";
  }
  return json.count;
}
