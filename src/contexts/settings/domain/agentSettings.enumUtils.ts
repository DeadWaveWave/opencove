export function isOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === 'string' && allowed.includes(value)
}

export function normalizeStringOrder<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number][] {
  if (!Array.isArray(value)) {
    return [...allowed]
  }

  const normalized: T[number][] = []
  const seen = new Set<T[number]>()

  for (const item of value) {
    if (!isOneOf(item, allowed)) {
      continue
    }

    if (seen.has(item)) {
      continue
    }

    seen.add(item)
    normalized.push(item)
  }

  for (const item of allowed) {
    if (seen.has(item)) {
      continue
    }

    seen.add(item)
    normalized.push(item)
  }

  return normalized
}
