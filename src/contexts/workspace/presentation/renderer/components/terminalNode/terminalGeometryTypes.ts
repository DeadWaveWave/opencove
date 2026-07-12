export type PtySize = { cols: number; rows: number }

export type InitialTerminalNodeGeometryCommitResult = PtySize & { changed: boolean }

export type FitTerminalNodeOptions = {
  refreshWhenStable?: boolean
  logWhenStable?: boolean
}
