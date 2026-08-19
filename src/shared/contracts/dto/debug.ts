export type TerminalDiagnosticsBufferKind = 'normal' | 'alternate' | 'unknown'
export type TerminalDiagnosticsNodeKind = 'terminal' | 'agent'
export type TerminalDiagnosticsSnapshotValue = string | number | boolean | null

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
  [key: string]: TerminalDiagnosticsSnapshotValue
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

export type RuntimeDiagnosticsLevel = 'info' | 'error'
export type RuntimeDiagnosticsSource =
  | 'main-app'
  | 'main-window'
  | 'renderer-error-boundary'
  | 'renderer-performance-monitor'
  | 'renderer-workspace-canvas'
export type RuntimeDiagnosticsDetailValue = string | number | boolean | null

export interface RuntimeDiagnosticsLogInput {
  source: RuntimeDiagnosticsSource
  level: RuntimeDiagnosticsLevel
  event: string
  message: string
  details?: Record<string, RuntimeDiagnosticsDetailValue>
}

export type UiDiagnosticBreadcrumbEvent =
  | 'window-geometry'
  | 'window-resize'
  | 'canvas-geometry'
  | 'canvas-viewport-change'

export interface UiDiagnosticBreadcrumbInput {
  source: 'renderer-ui'
  event: UiDiagnosticBreadcrumbEvent
  details: Record<string, RuntimeDiagnosticsDetailValue>
}
