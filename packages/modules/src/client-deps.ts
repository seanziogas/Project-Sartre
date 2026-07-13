/** Static dependencies remain convenient for tests; production resolves per client. */
export type ClientDeps<T> = T | ((clientId: string) => T | Promise<T>)

export function resolveClientDeps<T>(source: ClientDeps<T>, clientId: string): Promise<T> {
  return Promise.resolve(typeof source === 'function'
    ? (source as (id: string) => T | Promise<T>)(clientId)
    : source)
}
