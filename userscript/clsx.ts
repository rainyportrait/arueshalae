type ClassValue =
    | string
    | number
    | null
    | undefined
    | boolean
    | ClassValue[]
    | Record<string, unknown>

function toVal(mix: ClassValue): string {
    let str = ""

    if (typeof mix === "string" || typeof mix === "number") {
        str += mix
    } else if (typeof mix === "object") {
        if (Array.isArray(mix)) {
            for (let k = 0; k < mix.length; k++) {
                if (mix[k]) {
                    const y = toVal(mix[k])
                    if (y) {
                        str && (str += " ")
                        str += y
                    }
                }
            }
        } else {
            for (const y in mix) {
                if (mix[y]) {
                    str && (str += " ")
                    str += y
                }
            }
        }
    }

    return str
}

export function clsx(...inputs: ClassValue[]): string {
    let str = ""
    for (const tmp of inputs) {
        if (tmp) {
            const x = toVal(tmp)
            if (x) {
                str && (str += " ")
                str += x
            }
        }
    }
    return str
}

export default clsx
