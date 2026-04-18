import { initUI } from "./app"

import "./router"

initUI()

console.log("Arueshalae UI - Loaded")

// const search = new URLSearchParams(location.search)
// switch (search.get("page")) {
// 	case "favorites": {
// 		favorites()
// 		break
// 	}
// 	case "post": {
// 		const site = search.get("s")
// 		addSearchEnhancements()
// 		if (site === "list") {
// 			postList()
// 			break
// 		}
// 		if (site === "view") {
// 			const id = Number.parseInt(search.get("id") ?? "", 10)
// 			if (Number.isNaN(id)) break
// 			post(id)
// 			break
// 		}
// 	}
// 	case "pool": {
// 		pool()
// 		break
// 	}
// }
