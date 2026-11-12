/** Paths address properties of every array element, never array indexes. */
export function outputPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap(item => outputPaths(item, prefix)))]
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  return Object.entries(value).flatMap(([key, child]) => {
    // Dot paths cannot address literal dots, empty segments or array indexes.
    if (!key || key.includes('.') || /^-?\d+$/.test(key)) {
      return []
    }
    const path = prefix ? `${prefix}.${key}` : key
    return [path, ...outputPaths(child, path)]
  })
}

export function hasPath(value: unknown, path: string[]): boolean {
  if (!path.length) {
    return value !== undefined
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.some(item => hasPath(item, path))
  }
  return (
    !!value &&
    typeof value === 'object' &&
    Object.hasOwn(value, path[0]) &&
    hasPath((value as Record<string, unknown>)[path[0]], path.slice(1))
  )
}

export function project(value: unknown, paths: string[][]): unknown {
  if (paths.some(path => !path.length) || value === null || value === undefined) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => project(item, paths))
  }
  const out: Record<string, unknown> = Object.create(null)
  if (typeof value !== 'object') {
    return out
  }
  const groups = new Map<string, string[][]>()
  for (const [key, ...rest] of paths) {
    groups.set(key, [...(groups.get(key) ?? []), rest])
  }
  for (const [key, rest] of groups) {
    const child = (value as Record<string, unknown>)[key]
    if (Object.hasOwn(value, key) && rest.some(path => hasPath(child, path))) {
      out[key] = project(child, rest)
    }
  }
  return out
}
