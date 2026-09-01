import van from "vanjs-core"

const { meta, style, title } = van.tags

// Replace the document head with our own: the app title, the bundled
// Tailwind stylesheet (injected as TAILWIND_CSS by the build banner), and the
// viewport meta.
export function initHead(): void {
    document.head.innerHTML = ""
    van.add(document.head, [
        title("Rule34.xxx - Arueshalae"),
        style(TAILWIND_CSS),
        meta({
            name: "viewport",
            content: "width=device-width, initial-scale=1.0, maximum-scale=1.0",
        }),
    ])
}
