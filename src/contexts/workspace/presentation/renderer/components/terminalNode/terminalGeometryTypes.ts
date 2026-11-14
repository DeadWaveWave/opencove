export type PtySize = { cols: number; rows: number }

export type InitialTerminalNodeGeometryCommitResult = PtySize & {
  changed: boolean
  // @compat pty-geometry-legacy-revision
  // Correlated Worker result; unknown/legacy commits keep strict size matching.
  geometryRevision?: number | null
}

export type FitTerminalNodeOptions = {
  refreshWhenStable?: boolean
  logWhenStable?: boolean
}
