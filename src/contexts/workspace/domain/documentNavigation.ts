export interface DocumentNavigationLocation {
  line?: number
  column?: number
  lineEnd?: number
  columnEnd?: number
}

export interface DocumentNavigationIntent extends DocumentNavigationLocation {
  requestId: number
  uri: string
  mountId: string | null
}

interface DocumentNavigationSpace {
  id: string
  targetMountId?: string | null
  nodeIds: string[]
}

/** Visual containment cannot change the filesystem that produced a terminal link. */
export function resolveDocumentNavigationDestination(
  spaces: readonly DocumentNavigationSpace[],
  sourceNodeId: string,
  mountId: string | null,
): { spaceId: string | null } | null {
  const containingSpace = spaces.find(space => space.nodeIds.includes(sourceNodeId))
  if (containingSpace && (containingSpace.targetMountId ?? null) === mountId) {
    return { spaceId: containingSpace.id }
  }
  if (mountId === null) {
    return { spaceId: null }
  }
  const matching = spaces.filter(space => space.targetMountId === mountId)
  return matching.length === 1 ? { spaceId: matching[0].id } : null
}

interface DocumentNavigationTextModel {
  getLineCount: () => number
  getLineMaxColumn: (lineNumber: number) => number
}

function positiveInteger(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : null
}

export function resolveDocumentNavigationRange(
  location: DocumentNavigationLocation,
  model: DocumentNavigationTextModel,
): {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
} | null {
  const line = positiveInteger(location.line)
  if (line === null) {
    return null
  }
  const startLineNumber = Math.min(line, model.getLineCount())
  const startColumn = Math.min(
    positiveInteger(location.column) ?? 1,
    model.getLineMaxColumn(startLineNumber),
  )
  const endLineNumber = Math.max(
    startLineNumber,
    Math.min(positiveInteger(location.lineEnd) ?? startLineNumber, model.getLineCount()),
  )
  const endColumn = Math.min(
    positiveInteger(location.columnEnd) ??
      (endLineNumber === startLineNumber ? startColumn : model.getLineMaxColumn(endLineNumber)),
    model.getLineMaxColumn(endLineNumber),
  )
  return {
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn: endLineNumber === startLineNumber ? Math.max(startColumn, endColumn) : endColumn,
  }
}
