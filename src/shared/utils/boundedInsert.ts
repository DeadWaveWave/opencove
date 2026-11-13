/** Insert only with available capacity. The owner must preserve uncertainty on overflow. */
export function boundedInsert(
  size: number,
  limit: number,
  insert: () => void,
  overflow: () => void,
): boolean {
  if (size >= limit) {
    overflow()
    return false
  }
  insert()
  return true
}
