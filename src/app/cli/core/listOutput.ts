/** Presentation limits never affect lookup, mutation inputs, or server state. */
export function limitOutput(value: unknown, limit: unknown, listKey?: string): unknown {
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
  if (listKey && Array.isArray(result[listKey])) {
    const list = result[listKey] as unknown[]
    return list.length > count
      ? { ...result, [listKey]: list.slice(0, count), truncated: true, total: list.length }
      : value
  }
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

/** Capped command envelopes and tables share one notice, before projection. */
export function cappedListNotice(value: unknown, limit: unknown, listKey: string) {
  const list =
    value && typeof value === 'object' ? (value as Record<string, unknown>)[listKey] : undefined
  const count = Number(limit)
  return Array.isArray(list) && count > 0 && list.length > count
    ? `Showing ${count} of ${list.length} ${listKey}; ${list.length - count} omitted. Use --full or --limit 0 for all, or --limit <n> to choose a limit.`
    : undefined
}
