import type { IncomingMessage } from 'node:http'

export function isPtyStreamRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizePtyStreamOptionalString(value: unknown): string | null {
  if (value === null || value === undefined || typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizePtyStreamWriteData(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizePtyStreamAfterSeq(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.floor(value)
}

export function normalizePtyStreamRole(value: unknown): 'viewer' | 'controller' | null {
  return value === 'viewer' || value === 'controller' ? value : null
}

export function normalizePtyStreamPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const intValue = Math.floor(value)
  return intValue > 0 ? intValue : null
}

export function normalizePtyStreamOptionalPositiveInt(value: unknown): number | null {
  return value === null || value === undefined ? null : normalizePtyStreamPositiveInt(value)
}

export function normalizePtyStreamOptionalNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.floor(value)
}

export function normalizePtyStreamGeometryReason(
  value: unknown,
): 'frame_commit' | 'appearance_commit' | null {
  return value === 'frame_commit' || value === 'appearance_commit' ? value : null
}

export function resolveOfferedPtyStreamSubprotocols(
  header: IncomingMessage['headers'][string],
): string[] {
  const rawValues = typeof header === 'string' ? [header] : Array.isArray(header) ? header : []
  return rawValues
    .flatMap(value =>
      value
        .split(',')
        .map(part => part.trim())
        .filter(part => part.length > 0),
    )
    .filter((value, index, list) => list.indexOf(value) === index)
}
