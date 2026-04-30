import type { ReadFileBytesResult } from './filesystem'

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}

function normalizeBytes(value: unknown, operationId: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }

  if (Array.isArray(value)) {
    if (!value.every(isByte)) {
      throw new Error(`Invalid payload for ${operationId} bytes array.`)
    }

    return Uint8Array.from(value)
  }

  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid payload for ${operationId} bytes.`)
  }

  const entries = Object.entries(value)
  if (entries.length === 0) {
    return new Uint8Array(0)
  }

  const normalized = entries.map(([key, entryValue]) => {
    const index = Number.parseInt(key, 10)
    return Number.isInteger(index) && index >= 0 && isByte(entryValue)
      ? { index, value: entryValue }
      : null
  })

  if (normalized.some(entry => !entry)) {
    throw new Error(`Invalid payload for ${operationId} bytes object.`)
  }

  const sortedEntries = normalized
    .filter((entry): entry is { index: number; value: number } => entry !== null)
    .sort((left, right) => left.index - right.index)

  return Uint8Array.from(sortedEntries.map(entry => entry.value))
}

export function normalizeReadFileBytesResult(
  value: unknown,
  operationId: string,
): ReadFileBytesResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid payload for ${operationId}.`)
  }

  return {
    bytes: normalizeBytes((value as { bytes?: unknown }).bytes, operationId),
  }
}
