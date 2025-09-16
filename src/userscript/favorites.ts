import { FavoritesBar } from "./components/FavoritesBar"

export async function favorites() {
	improveStyles()

	const header = document.querySelector("#header")
	if (!header) throw new Error("Could not find header")

	header.after(FavoritesBar())
}

// Style improvments
function improveStyles() {
	Array.from(document.querySelectorAll(".thumb ~ br")).forEach((br) => br.remove())
	Array.from(document.querySelectorAll(".thumb > a")).forEach((e) => {
		e.removeAttribute("onclick")
	})
}
