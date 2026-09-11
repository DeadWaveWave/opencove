export function normalizeSidebarCollapsedIds(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter(([id, collapsed]) => id.length > 0 && collapsed === true),
  )
}

export function toggleSidebarCollapsedId(
  previous: Record<string, boolean>,
  id: string,
): Record<string, boolean> {
  if (previous[id] !== true) {
    return { ...previous, [id]: true }
  }
  const next = { ...previous }
  delete next[id]
  return next
}
