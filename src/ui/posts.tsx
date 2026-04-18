import { useSearch } from "wouter-preact"
import type { VNode } from "preact"

export function Posts(): VNode {
	const search = useSearch()

	// Parse query params
	const params = new URLSearchParams(search)
	const tags = params.get("tags") || "none"

	return (
		<div class="p-4">
			<h1 class="text-2xl font-bold mb-4">Posts</h1>
			<div class="bg-gray-100 p-4 rounded">
				<p class="mb-2">
					<span class="font-semibold">Search param:</span> {tags}
				</p>
				<p>
					<span class="font-semibold">Full query:</span> {search || "(none)"}
				</p>
			</div>
		</div>
	)
}
