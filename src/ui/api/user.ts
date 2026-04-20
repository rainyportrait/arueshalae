import { fetchDocument } from "./network"

export interface UserProfile {
	userId: number
	username: string
	favoriteCount: number
}

/**
 * Get the current logged-in user's ID.
 * Returns null if no user is logged in.
 */
export async function getUserId(): Promise<number | null> {
	const doc = await fetchDocument("/index.php?page=account&s=home")
	const myProfileLink = Array.from(doc.querySelectorAll("a")).find(
		(a) => (a.textContent ?? "").trim() === "My Profile",
	)

	if (!myProfileLink) {
		return null
	}

	const href = myProfileLink.getAttribute("href")
	if (!href) {
		return null
	}

	const url = new URL(href, "https://rule34.xxx")
	const userId = url.searchParams.get("id")?.trim()
	if (!userId) {
		return null
	}

	const parsedUserId = Number.parseInt(userId, 10)
	if (isNaN(parsedUserId)) {
		return null
	}

	return parsedUserId
}

/**
 * Fetch a user's profile by their userId.
 */
export async function getUserProfile(userId: number): Promise<UserProfile | null> {
	const doc = await fetchDocument(`/index.php?page=account&s=profile&id=${userId}`)

	// Get username from the first h2 in #content
	const content = doc.querySelector("#content")
	if (!content) {
		return null
	}

	const username = content.querySelector("h2")?.textContent?.trim() ?? ""

	// Get favorite count from the favorites link
	const favoritesString =
		doc.querySelector(`a[href="index.php?page=favorites&s=view&id=${userId}"]`)?.textContent ?? "0"
	const favoriteCount = Number.parseInt(favoritesString, 10)

	return {
		userId,
		username,
		favoriteCount,
	}
}
