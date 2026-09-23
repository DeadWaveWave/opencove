import type { FileSystemStat } from '@shared/contracts/dto'
import { normalizeFileUri } from '@shared/utils/fileUriScope'
import type { FilesystemEntryDragData } from './filesystemDrag'

export function hasNativeFileTransfer(transfer: DataTransfer): boolean {
  return Array.from(transfer.types ?? []).includes('Files') || transfer.files?.length > 0
}

export function readNativeDroppedFiles(transfer: DataTransfer): File[] {
  const filesystem = window.opencoveApi?.filesystem
  if (!filesystem?.resolveDroppedFile || !filesystem.getPathForFile) {
    return []
  }
  const seen = new Set<string>()
  return Array.from(transfer.files ?? []).filter(file => {
    try {
      const path = filesystem.getPathForFile(file)
      if (!path || seen.has(path)) {
        return false
      }
      seen.add(path)
      return true
    } catch {
      return false
    }
  })
}

export function toNativeFilesystemEntry(
  stat: FileSystemStat | null,
): FilesystemEntryDragData | null {
  const uri = normalizeFileUri(stat?.uri)
  if (!uri || (stat?.kind !== 'file' && stat?.kind !== 'directory')) {
    return null
  }
  return {
    version: 1,
    uri,
    kind: stat.kind,
    // A native selection grants access to that entry, not its parent directory.
    rootUri: uri,
    mountId: null,
  }
}
