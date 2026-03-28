export type TerminalDiagnosticsBufferKind = 'normal' | 'alternate' | 'unknown'
export type TerminalDiagnosticsNodeKind = 'terminal' | 'agent'

export interface TerminalDiagnosticsSnapshot {
  bufferKind: TerminalDiagnosticsBufferKind
  activeBaseY: number | null
  activeViewportY: number | null
  activeLength: number | null
  cols: number
  rows: number
  viewportScrollTop: number | null
  viewportScrollHeight: number | null
  viewportClientHeight: number | null
  hasViewport: boolean
  hasVerticalScrollbar: boolean
}

export type TerminalDiagnosticsDetailValue = string | number | boolean | null

export interface TerminalDiagnosticsLogInput {
  source: 'renderer-terminal'
  nodeId: string
  sessionId: string
  nodeKind: TerminalDiagnosticsNodeKind
  title: string
  event: string
  details?: Record<string, TerminalDiagnosticsDetailValue>
  snapshot: TerminalDiagnosticsSnapshot
}
