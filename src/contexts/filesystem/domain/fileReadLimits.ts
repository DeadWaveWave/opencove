/** Optional transport limits preserve existing unbounded callers. */
export function normalizeFileReadLimit(value: unknown, maximum: number): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`File read limit must be an integer between 1 and ${maximum}.`)
  }
  return value
}
