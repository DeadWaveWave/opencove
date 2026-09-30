/** Normalize transport values while rejecting silent JSON coercion and bounding UTF-8 bytes. */
export function pluginJsonValue(value: unknown, maxBytes: number, field: string): unknown {
  const json = JSON.stringify(value ?? null, (_key, item: unknown) => {
    if (
      typeof item === 'undefined' ||
      typeof item === 'function' ||
      typeof item === 'symbol' ||
      typeof item === 'bigint' ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      throw new Error(`Plugin ${field} must contain only JSON values.`)
    }
    return item
  })
  if (new TextEncoder().encode(json).byteLength > maxBytes) {
    throw new Error(`Plugin ${field} is too large.`)
  }
  return JSON.parse(json) as unknown
}
