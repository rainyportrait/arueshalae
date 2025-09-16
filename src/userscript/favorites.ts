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
	document
		.querySelector('link[rel="shortcut icon"]')
		?.setAttribute(
			"href",
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEABAMAAACuXLVVAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAVUExURf///3QMSf///wAAADADHf9Ct////2c1eNwAAAABdFJOUwE34ejwAAAAAWJLR0QGYWa4fQAAAAd0SU1FB+kJEBYxHoRvMBcAAAErSURBVHja7d3BDYNADARAWqCFtEALaSH9t5IP93Fk+YhQMNHsD27tGypgWfasP84SAwAAAAAAAHAZIB48kmwhsxdV8wAAAAAAAAB9AFlx5Chk9gMAAAAAAAAA+gC2IrOA2AMAAAAAAAC4L6BaHHvZOQAAAAAAAMB9AHFRzNGLq/MRAAAAAAAAgH6ArJgtenwZAAAAAAAAgP8BVKnmAAAAAAAAAPoAYjHCskVrEgAAAAAAAID7AeJATLZgLVLBAQAAAAAAAPoBZlNdnO2N5wAAAAAAAAB9ALOQ0XsWifuyOQAAAAAAAIA+gPHitWcMxuezewAAAAAAAAD9ANXCs3sAAAAAAAAA/QCxmA2e1QMAAAAAAAC4HjAyBuKC+HxW7+MPjwAAAAAAAABXAd6Fw/0tnobvcQAAAABJRU5ErkJggg==",
		)
}
