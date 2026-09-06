// Vertical gap between masonry rows (px). The grid itself uses a 0 row-gap;
// this is folded into each card's `grid-row-end` span instead.
export const MASONRY_GAP = 16

// Resize a masonry card's grid span to its current height plus the row gap.
// Called once each thumbnail has loaded, when the card reaches its final size.
// `offsetHeight` is used (rather than getBoundingClientRect) so the hover
// scale transform never influences the measured height.
export function setCardSpan(card: HTMLElement): void {
    card.style.gridRowEnd = `span ${card.offsetHeight + MASONRY_GAP}`
}

// Re-measure every card after a window resize. Card height follows the column
// width (images are width: 100%), so a resize invalidates the spans stored at
// load time: narrower columns leave a gap under each card, wider ones make
// the next card overlap it. Reads are batched before writes so the page
// reflows once per frame instead of once per card.
let resizeQueued = false
export function initMasonry(): void {
    window.addEventListener("resize", () => {
        if (resizeQueued) return
        resizeQueued = true
        requestAnimationFrame(() => {
            resizeQueued = false
            const cards = [...document.querySelectorAll<HTMLElement>(".masonry-item")]
            const heights = cards.map((card) => card.offsetHeight)
            cards.forEach((card, i) => {
                card.style.gridRowEnd = `span ${heights[i] + MASONRY_GAP}`
            })
        })
    })
}
