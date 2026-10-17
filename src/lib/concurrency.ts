/** Map over items with at most `limit` promises in flight; preserves input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i] as T, i)
    }
  })
  await Promise.all(workers)
  return results
}

/** Collapse concurrent calls with the same key into one in-flight promise. */
export function singleflight<T>() {
  const inflight = new Map<string, Promise<T>>()
  return (key: string, fn: () => Promise<T>): Promise<T> => {
    const existing = inflight.get(key)
    if (existing) return existing
    const p = fn().finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }
}
