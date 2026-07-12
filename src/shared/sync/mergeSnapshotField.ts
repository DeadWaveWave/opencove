export function mergeSnapshotField<T>(
  baseValue: T,
  localValue: T,
  snapshotValue: T | undefined,
  equals: (left: T, right: T) => boolean,
): T {
  if (snapshotValue === undefined) {
    return localValue
  }

  const baseChanged = !equals(baseValue, snapshotValue)
  const localChanged = !equals(localValue, snapshotValue)

  if (localChanged && !baseChanged) {
    return localValue
  }

  if (!localChanged && baseChanged) {
    return baseValue
  }

  if (!localChanged && !baseChanged) {
    return baseValue
  }

  return localValue
}
