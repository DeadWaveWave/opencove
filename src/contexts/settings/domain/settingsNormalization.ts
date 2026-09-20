export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function areNormalizedSettingsValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => areNormalizedSettingsValuesEqual(item, right[index]))
    )
  }

  if (!isRecord(left) || !isRecord(right)) {
    return false
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      key =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        areNormalizedSettingsValuesEqual(left[key], right[key]),
    )
  )
}

export function normalizeTextValue(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

export function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value !== 'boolean') {
    return null
  }

  return value
}

export function normalizeIntegerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const normalized = Math.round(value)
  return Math.max(min, Math.min(max, normalized))
}

export function normalizeUniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: string[] = []
  for (const item of value) {
    const entry = normalizeTextValue(item)
    if (entry.length === 0 || normalized.includes(entry)) {
      continue
    }

    normalized.push(entry)
  }

  return normalized
}

export function normalizeUniqueStringArrayWithFallback(
  value: unknown,
  fallback: string[],
): string[] {
  if (!Array.isArray(value)) {
    return [...fallback]
  }

  const normalized: string[] = []
  for (const item of value) {
    const entry = normalizeTextValue(item)
    if (entry.length === 0 || normalized.includes(entry)) {
      continue
    }

    normalized.push(entry)
  }

  return normalized.length > 0 ? normalized : [...fallback]
}
