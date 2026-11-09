export type PtySize = { cols: number; rows: number }

export type InitialTerminalNodeGeometryCommitResult = PtySize & {
  changed: boolean
  // Correlated Worker result; unknown/legacy commits keep strict size matching.
  geometryRevision?: number | null
}

export type FitTerminalNodeOptions = {
  refreshWhenStable?: boolean
  logWhenStable?: boolean
}
