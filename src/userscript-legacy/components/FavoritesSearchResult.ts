import van from "vanjs-core"

const { div, h1, span, a, button, img } = van.tags

export function FavoritesSearchResult(term: string, postIds: number[]) {
	const open = van.state(true)
	const ids = van.state(postIds)
	const isShuffled = van.state(false)

	return () =>
		open.val
			? div(
					{ class: "arue-ui-search" },
					div(
						{ class: "arue-ui-search-header" },
						div(() =>
							!isShuffled.val
								? button(
										{
											class: "arue-btn",
											onclick: () => {
												ids.val = shuffle(ids.val)
												isShuffled.val = true
											},
										},
										"Shuffle",
									)
								: button(
										{
											class: "arue-btn",
											onclick: () => {
												ids.val = postIds
												isShuffled.val = false
											},
										},
										"Undo shuffle",
									),
						),
						h1(
							span(`${postIds.length} result${postIds.length > 1 ? "s" : ""} for `),
							a(
								{
									href: `https://rule34.xxx/index.php?page=post&s=list&tags=${term}`,
									target: "_blank",
								},
								term,
							),
						),
						button({ class: "arue-btn", onclick: () => (open.val = false) }, "X"),
					),
					div(
						{ class: "arue-ui-search-grid" },
						ids.val.map((id) => {
							return a(
								{
									href: `https://rule34.xxx/index.php?page=post&s=view&id=${id}&tags=${term}`,
									target: "_blank",
								},
								img({
									src: `http://localhost:34343/image/mini/${id}`,
									width: "300",
									loading: "lazy",
								}),
							)
						}),
					),
				)
			: null
}

function shuffle<T>(input: T[]): T[] {
	return input
		.map((value) => ({ value, sort: Math.random() }))
		.sort((a, b) => a.sort - b.sort)
		.map(({ value }) => value)
}
