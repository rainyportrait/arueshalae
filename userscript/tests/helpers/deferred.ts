export type Deferred<T> = {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (reason?: unknown) => void
}

export function deferred<T>(): Deferred<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>()
    return { promise, resolve, reject }
}
