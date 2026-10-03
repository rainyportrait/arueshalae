// Toggle shortcuts run once per press; navigation can opt into held-key repeats.
export function isShortcutEvent(event: KeyboardEvent, allowRepeat = false): boolean {
    if (
        event.isComposing ||
        (!allowRepeat && event.repeat) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
    )
        return false
    const target = event.target
    return !(
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    )
}
