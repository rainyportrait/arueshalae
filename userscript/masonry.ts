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
