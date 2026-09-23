import type { DocumentNodeData } from '../../types'

export function ensurePersistedDocumentData(value: unknown): DocumentNodeData | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  const uri = typeof record.uri === 'string' ? record.uri.trim() : ''
  if (uri.length === 0) {
    return null
  }
  try {
    if (new URL(uri).protocol !== 'file:') {
      return null
    }
  } catch {
    return null
  }
  return { uri }
}
