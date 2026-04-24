import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type {
  PresentationSnapshotTerminalResult,
  TerminalDiagnosticsLogInput,
} from '@shared/contracts/dto'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { AgentLaunchMode, WorkspaceNodeKind } from '../../types'
import type { AttachablePtyApi } from './attachablePty'
import { createOpenCodeTuiThemeBridge } from './opencodeTuiThemeBridge'
import type { TerminalThemeMode } from './theme'
import { registerRuntimeTerminalRendererHealth } from './runtimeRendererHealth'
import type { TerminalRendererRecoveryRequest } from './runtimeRendererHealth'
import type { TerminalRendererKind } from './useWebglPixelSnappingScheduler'
import type { XtermSession } from './xtermSession'

export function shouldGateRestoredAgentInput(options: {
  kind: WorkspaceNodeKind
  isLiveSessionReattach: boolean
  persistedSnapshot: string
}): boolean {
  return (
    options.kind === 'agent' &&
    !options.isLiveSessionReattach &&
    options.persistedSnapshot.trim().length > 0
  )
}

export function shouldProtectRestoredAgentHistory(options: {
  kind: WorkspaceNodeKind
  isLiveSessionReattach: boolean
  agentResumeSessionIdVerified: boolean
  agentLaunchMode: AgentLaunchMode | null
  persistedSnapshot: string
}): boolean {
  return (
    options.kind === 'agent' &&
    !options.isLiveSessionReattach &&
    (options.agentResumeSessionIdVerified ||
      options.agentLaunchMode === 'resume' ||
      options.persistedSnapshot.trim().length > 0)
  )
}

export function scheduleTestEnvironmentTerminalAutoFocus(options: {
  enabled: boolean
  container: HTMLDivElement | null
  terminal: Terminal
  scheduleTranscriptSync: () => void
}): number | null {
  if (!options.enabled || !options.container) {
    return null
  }

  return window.requestAnimationFrame(() => {
    const activeElement = document.activeElement instanceof Element ? document.activeElement : null
    const activeTerminalScope = activeElement?.closest('[data-cove-focus-scope="terminal"]') ?? null
    const shouldAutoFocusTerminal =
      !activeElement ||
      activeElement === document.body ||
      activeElement === document.documentElement ||
      activeTerminalScope === options.container

    if (shouldAutoFocusTerminal) {
      options.terminal.focus()
    }

    options.scheduleTranscriptSync()
  })
}

export function requestPresentationSnapshot(
  sessionId: string,
): Promise<PresentationSnapshotTerminalResult | null> {
  return typeof window.opencoveApi.pty.presentationSnapshot === 'function'
    ? window.opencoveApi.pty
        .presentationSnapshot({ sessionId })
        .then(snapshot => snapshot ?? null)
        .catch(() => null)
    : Promise.resolve(null)
}

export function attachAfterPresentationSnapshot(options: {
  ptyApi: AttachablePtyApi
  sessionId: string
  presentationSnapshotPromise: Promise<PresentationSnapshotTerminalResult | null>
}): Promise<void | undefined> {
  return options.presentationSnapshotPromise.then(async () => {
    return await options.ptyApi.attach?.({ sessionId: options.sessionId })
  })
}

export function createOptionalOpenCodeThemeBridge(options: {
  terminalProvider: AgentProvider | null
  terminal: Terminal
  ptyWriteQueue: {
    enqueue: (data: string, encoding?: 'utf8' | 'binary') => void
    flush: () => void
  }
  terminalThemeMode: TerminalThemeMode
}) {
  return options.terminalProvider === 'opencode'
    ? createOpenCodeTuiThemeBridge({
        terminal: options.terminal,
        ptyWriteQueue: options.ptyWriteQueue,
        terminalThemeMode: options.terminalThemeMode,
      })
    : null
}

export function registerRuntimeRendererAndThemeSync(options: {
  terminal: Terminal
  renderer: XtermSession['renderer']
  containerRef: MutableRefObject<HTMLDivElement | null>
  activeRendererKindRef: MutableRefObject<TerminalRendererKind>
  isTerminalHydratedRef: MutableRefObject<boolean>
  syncTerminalSize: () => void
  scheduleWebglPixelSnapping: () => void
  log: (event: string, details?: TerminalDiagnosticsLogInput['details']) => void
  requestRecovery: (request: TerminalRendererRecoveryRequest) => void
  terminalThemeMode: TerminalThemeMode
  applyTerminalTheme: () => void
  reportOpenCodeThemeMode: () => void
}) {
  const runtimeRendererHealth = registerRuntimeTerminalRendererHealth({
    terminal: options.terminal,
    renderer: options.renderer,
    containerRef: options.containerRef,
    activeRendererKindRef: options.activeRendererKindRef,
    isTerminalHydratedRef: options.isTerminalHydratedRef,
    syncTerminalSize: options.syncTerminalSize,
    scheduleWebglPixelSnapping: options.scheduleWebglPixelSnapping,
    log: options.log,
    requestRecovery: options.requestRecovery,
  })

  const handleThemeChange = () => {
    if (options.terminalThemeMode !== 'sync-with-ui') {
      return
    }
    options.applyTerminalTheme()
    runtimeRendererHealth.notifyLayoutTrigger('theme_change')
    options.reportOpenCodeThemeMode()
  }

  window.addEventListener('opencove-theme-changed', handleThemeChange)
  return () => {
    window.removeEventListener('opencove-theme-changed', handleThemeChange)
    runtimeRendererHealth.dispose()
  }
}
