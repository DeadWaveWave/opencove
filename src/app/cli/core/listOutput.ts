/** Presentation limits never affect lookup, mutation inputs, or server state. */
export function limitOutput(value: unknown, limit: unknown): unknown {
  if (limit === undefined || Number(limit) === 0) {
    return value
  }
  const count = Number(limit)
  if (Array.isArray(value)) {
    return value.length > count ? value.slice(0, count) : value
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const result = { ...value } as Record<string, unknown>
  const truncated: Record<string, number> = {}
  for (const [key, list] of Object.entries(result)) {
    if (Array.isArray(list) && list.length > count) {
      result[key] = list.slice(0, count)
      truncated[key] = list.length
    }
  }
  return Object.keys(truncated).length
    ? { ...result, truncated: { ...(result.truncated as object), ...truncated } }
    : value
}

/** Bare arrays and table rows retain their stdout shape; stderr carries their truncation notice. */
export function listLimitNotice(
  value: unknown,
  limit: unknown,
  label = 'items',
): string | undefined {
  const count = Number(limit)
  return Array.isArray(value) && count > 0 && value.length > count
    ? `Showing ${count} of ${value.length} ${label}; use --limit 0 for all.`
    : undefined
}
