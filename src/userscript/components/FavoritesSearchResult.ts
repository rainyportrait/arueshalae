import van from "vanjs-core"

const { div, h1, span, a, button, img } = van.tags

export function FavoritesSearchResult(term: string, postIds: number[]) {
	const open = van.state(true)
	return () =>
		open.val
			? div(
					{ class: "arue-ui-search" },
					div(
						{ class: "arue-ui-search-header" },
						div(),
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
						postIds.map((id) => {
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
