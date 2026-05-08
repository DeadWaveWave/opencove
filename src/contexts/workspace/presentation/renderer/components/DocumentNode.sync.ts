import type { FileSystemStat } from '@shared/contracts/dto'

export type DocumentNodeExternalRefreshDecision = 'unchanged' | 'reload' | 'conflict'

export function isDocumentNodeFileStatEqual(
  left: FileSystemStat | null,
  right: FileSystemStat | null,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return (
    left.kind === right.kind &&
    left.sizeBytes === right.sizeBytes &&
    left.mtimeMs === right.mtimeMs &&
    left.uri === right.uri
  )
}

export function resolveDocumentNodeExternalRefreshDecision(options: {
  currentStat: FileSystemStat | null
  observedStat: FileSystemStat | null
  conflictStat: FileSystemStat | null
  isDirty: boolean
}): DocumentNodeExternalRefreshDecision {
  const { currentStat, observedStat, conflictStat, isDirty } = options

  if (isDocumentNodeFileStatEqual(observedStat, currentStat)) {
    return 'unchanged'
  }

  if (isDocumentNodeFileStatEqual(observedStat, conflictStat)) {
    return 'unchanged'
  }

  return isDirty ? 'conflict' : 'reload'
}
