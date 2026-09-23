import { isFileUriWithinRoot, normalizeFileUri } from '@shared/utils/fileUriScope'

export const FILESYSTEM_ENTRY_MIME = 'application/x-opencove-filesystem-entry'

export interface FilesystemEntryDragData {
  version: 1
  uri: string
  kind: 'file' | 'directory'
  rootUri: string
  mountId: string | null
  sourceSpaceId?: string | null
}

export function normalizeFilesystemEntryDragData(value: unknown): FilesystemEntryDragData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const uri = normalizeFileUri(record.uri)
  const rootUri = normalizeFileUri(record.rootUri)
  if (
    record.version !== 1 ||
    (record.kind !== 'file' && record.kind !== 'directory') ||
    !uri ||
    !rootUri ||
    !isFileUriWithinRoot(rootUri, uri) ||
    (record.mountId !== null && (typeof record.mountId !== 'string' || !record.mountId.trim()))
  ) {
    return null
  }
  return {
    version: 1,
    uri,
    kind: record.kind,
    rootUri,
    mountId: typeof record.mountId === 'string' ? record.mountId.trim() : null,
    sourceSpaceId: typeof record.sourceSpaceId === 'string' ? record.sourceSpaceId : null,
  }
}

export function setFilesystemEntryDragData(
  transfer: DataTransfer,
  payload: FilesystemEntryDragData,
): void {
  const normalized = normalizeFilesystemEntryDragData(payload)
  if (!normalized) {
    return
  }
  transfer.setData(FILESYSTEM_ENTRY_MIME, JSON.stringify(normalized))
  transfer.effectAllowed = 'copyMove'
}

export function hasFilesystemEntryDragData(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).includes(FILESYSTEM_ENTRY_MIME)
}

export function readFilesystemEntryDragData(
  transfer: DataTransfer,
): FilesystemEntryDragData | null {
  try {
    return normalizeFilesystemEntryDragData(JSON.parse(transfer.getData(FILESYSTEM_ENTRY_MIME)))
  } catch {
    return null
  }
}

/** Only background drops create references; a directory/editor owns its own drops. */
export function isFilesystemCanvasDropTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !target.closest(
      '.react-flow__node, .workspace-space-explorer, [data-cove-focus-scope="file-browser"], input, textarea, [contenteditable="true"]',
    )
  )
}
