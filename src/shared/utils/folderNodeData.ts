import type { PersistedFolderNodeData } from '@shared/contracts/persistedAppState'
import { isFileUriWithinRoot, normalizeFileUri } from './fileUriScope'

export function normalizeFolderNodeData(value: unknown): PersistedFolderNodeData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const uri = normalizeFileUri(record.uri)
  const rootUri = normalizeFileUri(record.rootUri)
  if (!uri || !rootUri || !isFileUriWithinRoot(rootUri, uri)) {
    return null
  }
  const expandedDirectoryUris = Array.isArray(record.expandedDirectoryUris)
    ? [...new Set(record.expandedDirectoryUris.map(normalizeFileUri))].filter(
        (candidate): candidate is string => !!candidate && isFileUriWithinRoot(rootUri, candidate),
      )
    : []
  return {
    uri,
    rootUri,
    viewMode: record.viewMode === 'list' ? 'list' : 'icons',
    expandedDirectoryUris,
  }
}

export function isFolderNodeData(value: unknown): value is PersistedFolderNodeData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    normalizeFolderNodeData(record) !== null &&
    (record.viewMode === 'icons' || record.viewMode === 'list') &&
    Array.isArray(record.expandedDirectoryUris) &&
    record.expandedDirectoryUris.every(
      uri => typeof uri === 'string' && isFileUriWithinRoot(record.rootUri as string, uri),
    )
  )
}
