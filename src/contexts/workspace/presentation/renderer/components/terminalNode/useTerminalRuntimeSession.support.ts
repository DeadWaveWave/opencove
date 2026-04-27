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

export type TerminalHydrationBaselineSource =
  | 'empty'
  | 'placeholder_snapshot'
  | 'presentation_snapshot'
  | 'live_pty_snapshot'

export function shouldGateRestoredAgentInput(options: {
  kind: WorkspaceNodeKind
  isLiveSessionReattach: boolean
  persistedSnapshot: string
}): boolean {
  void options

  // Live runtime sessions should never gate user input behind renderer-side restore heuristics.
  // If the user types before the runtime session mounts, the placeholder session already buffers
  // that input for handoff. Once a real sessionId exists, correctness belongs to the runtime.
  return false
}

export function shouldProtectRestoredAgentHistory(options: {
  kind: WorkspaceNodeKind
  agentResumeSessionIdVerified: boolean
  agentLaunchMode: AgentLaunchMode | null
  persistedSnapshot: string
}): boolean {
  return (
    options.kind === 'agent' &&
    (options.agentResumeSessionIdVerified ||
      options.agentLaunchMode === 'resume' ||
      options.persistedSnapshot.trim().length > 0)
  )
}

export function isAuthoritativeHydrationBaselineSource(
  source: TerminalHydrationBaselineSource,
): boolean {
  return source === 'presentation_snapshot' || source === 'live_pty_snapshot'
}

export function shouldTreatHydratedAgentBaselineAsPlaceholder(options: {
  kind: WorkspaceNodeKind
  agentResumeSessionIdVerified: boolean
  agentLaunchMode: AgentLaunchMode | null
  persistedSnapshot: string
  baselineSource: TerminalHydrationBaselineSource
}): boolean {
  return (
    shouldProtectRestoredAgentHistory({
      kind: options.kind,
      agentResumeSessionIdVerified: options.agentResumeSessionIdVerified,
      agentLaunchMode: options.agentLaunchMode,
      persistedSnapshot: options.persistedSnapshot,
    }) && !isAuthoritativeHydrationBaselineSource(options.baselineSource)
  )
}

export function shouldProtectHydratedAgentHistory(options: {
  kind: WorkspaceNodeKind
  agentResumeSessionIdVerified: boolean
  agentLaunchMode: AgentLaunchMode | null
  persistedSnapshot: string
}): boolean {
  return shouldProtectRestoredAgentHistory({
    kind: options.kind,
    agentResumeSessionIdVerified: options.agentResumeSessionIdVerified,
    agentLaunchMode: options.agentLaunchMode,
    persistedSnapshot: options.persistedSnapshot,
  })
}

export function shouldReusePreservedXtermSession(options: {
  preservedSession: XtermSession | null
  terminalClientResetVersion: number
}): options is {
  preservedSession: XtermSession
  terminalClientResetVersion: number
} {
  return (
    options.preservedSession !== null &&
    options.terminalClientResetVersion === 0 &&
    options.preservedSession.renderer.kind === 'dom'
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

export async function requestPresentationSnapshotAfterGeometry({
  sessionId,
  expectedGeometry,
  requestSnapshot = requestPresentationSnapshot,
  wait = attempt =>
    new Promise<void>(resolve => {
      window.setTimeout(resolve, Math.min(50 + attempt * 25, 150))
    }),
  maxAttempts = 8,
}: {
  sessionId: string
  expectedGeometry: { cols: number; rows: number } | null
  requestSnapshot?: (sessionId: string) => Promise<PresentationSnapshotTerminalResult | null>
  wait?: (attempt: number) => Promise<void>
  maxAttempts?: number
}): Promise<PresentationSnapshotTerminalResult | null> {
  if (!expectedGeometry) {
    return await requestSnapshot(sessionId)
  }

  const attemptRequest = async (
    attempt: number,
  ): Promise<PresentationSnapshotTerminalResult | null> => {
    if (attempt >= maxAttempts) {
      return null
    }

    const snapshot = await requestSnapshot(sessionId)
    if (!snapshot) {
      return null
    }

    if (snapshot.cols === expectedGeometry.cols && snapshot.rows === expectedGeometry.rows) {
      return snapshot
    }

    if (attempt < maxAttempts - 1) {
      await wait(attempt)
    }

    return attemptRequest(attempt + 1)
  }

  return attemptRequest(0)
}

export function attachAfterPresentationSnapshot(options: {
  ptyApi: AttachablePtyApi
  sessionId: string
  presentationSnapshotPromise: Promise<PresentationSnapshotTerminalResult | null>
}): Promise<void | undefined> {
  return options.presentationSnapshotPromise.then(async snapshot => {
    return await options.ptyApi.attach?.({
      sessionId: options.sessionId,
      ...(snapshot ? { afterSeq: snapshot.appliedSeq } : {}),
    })
  })
}

export function prepareRuntimePresentationAttach(options: {
  ptyApi: AttachablePtyApi
  sessionId: string
  isLiveSessionReattach: boolean
  commitInitialGeometry: () => Promise<{ cols: number; rows: number } | null>
}): {
  attachPromise: Promise<void | undefined>
  presentationSnapshotPromise: Promise<PresentationSnapshotTerminalResult | null>
} {
  const preAttachPresentationSnapshotPromise = requestPresentationSnapshot(options.sessionId)
  const attachPromise = attachAfterPresentationSnapshot({
    ptyApi: options.ptyApi,
    sessionId: options.sessionId,
    presentationSnapshotPromise: preAttachPresentationSnapshotPromise,
  })
  const initialGeometryCommitPromise = options.isLiveSessionReattach
    ? Promise.resolve(null)
    : attachPromise
        .catch(() => undefined)
        .then(() => options.commitInitialGeometry())
        .catch(() => null)
  const presentationSnapshotPromise = options.isLiveSessionReattach
    ? preAttachPresentationSnapshotPromise
    : initialGeometryCommitPromise.then(expectedGeometry =>
        requestPresentationSnapshotAfterGeometry({
          sessionId: options.sessionId,
          expectedGeometry,
        }),
      )

  return { attachPromise, presentationSnapshotPromise }
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
