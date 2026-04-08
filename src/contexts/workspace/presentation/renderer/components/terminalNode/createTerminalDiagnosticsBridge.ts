import type { TerminalWindowsPty } from '@shared/contracts/dto'
import type { Terminal } from '@xterm/xterm'
import { registerTerminalDiagnostics } from './registerDiagnostics'
import type { TerminalThemeMode } from './theme'
import type { TerminalShortcutDecision } from './inputBridge'

export function createTerminalDiagnosticsBridge({
  container,
  diagnosticsEnabled,
  emit,
  kind,
  nodeId,
  rendererKind,
  sessionId,
  terminal,
  terminalThemeMode,
  title,
  windowsPty,
}: {
  container: HTMLDivElement | null
  diagnosticsEnabled: boolean
  emit: (payload: {
    source: 'renderer-terminal'
    nodeId: string
    sessionId: string
    nodeKind: 'terminal' | 'agent'
    title: string
    event: string
    details?: Record<string, string | number | boolean | null>
    snapshot: unknown
  }) => void
  kind: 'terminal' | 'agent'
  nodeId: string
  rendererKind: 'webgl' | 'dom'
  sessionId: string
  terminal: Terminal
  terminalThemeMode: TerminalThemeMode
  title: string
  windowsPty: TerminalWindowsPty | null
}) {
  const terminalDiagnostics = registerTerminalDiagnostics({
    enabled: diagnosticsEnabled,
    emit,
    nodeId,
    sessionId,
    nodeKind: kind,
    title,
    terminal,
    container,
    rendererKind,
    terminalThemeMode,
    windowsPty,
  })

  return {
    logPtyWrite: (payload: { data: string; encoding: 'utf8' | 'binary' }) => {
      terminalDiagnostics.logPtyWrite(payload)
    },
    logShortcutDecision: (decision: TerminalShortcutDecision) => {
      terminalDiagnostics.logKeyboardShortcut(decision)
    },
    terminalDiagnostics,
  }
}
