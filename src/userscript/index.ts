import { addSearchEnhancements } from "./components/SearchEnhancements.ts"
import "./context.d.ts"
import { favorites } from "./favorites.ts"
import { postList } from "./post-list.ts"
import { post } from "./post.ts"
import "./styles"

const search = new URLSearchParams(location.search)
switch (search.get("page")) {
	case "favorites": {
		favorites()
		break
	}
	case "post": {
		const site = search.get("s")
		addSearchEnhancements()
		if (site === "list") {
			postList()
			break
		}
		if (site === "view") {
			const id = Number.parseInt(search.get("id") ?? "", 10)
			if (Number.isNaN(id)) break
			post(id)
			break
		}
	}
}
