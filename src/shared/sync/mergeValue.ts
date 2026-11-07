/** Stable JSON content; object insertion order is not part of durable identity. */
export function canonicalContent(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const ordered: Record<string, unknown> = Object.create(null)
      // Default sort compares UTF-16 code units, independent of the host locale.
      for (const key of Object.keys(item).sort()) {
        ordered[key] = (item as Record<string, unknown>)[key]
      }
      return ordered
    }
    return item
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

/** Arrays are atomic. Undefined represents an absent object key. */
export function mergeValue<T>(latest: T, local: T, ancestor: T): T {
  if (canonicalContent(local) === canonicalContent(ancestor)) {
    return latest
  }
  if (canonicalContent(latest) === canonicalContent(ancestor)) {
    return local
  }
  if (canonicalContent(local) === canonicalContent(latest)) {
    return local
  }
  if (isPlainObject(latest) && isPlainObject(local) && isPlainObject(ancestor)) {
    const entries = [
      ...new Set([...Object.keys(latest), ...Object.keys(local), ...Object.keys(ancestor)]),
    ]
      .map(key => [key, mergeValue(latest[key], local[key], ancestor[key])] as const)
      .filter(([, value]) => value !== undefined)
    return Object.fromEntries(entries) as T
  }
  return local
}
