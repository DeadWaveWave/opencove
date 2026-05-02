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
import { containsMeaningfulTerminalDisplayContent } from './hydrationReplacement'
import type { TerminalThemeMode } from './theme'
import { registerRuntimeTerminalRendererHealth } from './runtimeRendererHealth'
import type { TerminalRendererRecoveryRequest } from './runtimeRendererHealth'
import type { TerminalRendererKind } from './useWebglCanvasTransformCleanupScheduler'
import type { XtermSession } from './xtermSession'

export type TerminalHydrationBaselineSource =
  | 'empty'
  | 'placeholder_snapshot'
  | 'presentation_snapshot'
  | 'live_pty_snapshot'

export function shouldGateRestoredAgentInput(options: {
  kind: WorkspaceNodeKind
  persistedSnapshot: string
  agentResumeSessionIdVerified: boolean
  agentLaunchMode: AgentLaunchMode | null
}): boolean {
  void options.persistedSnapshot
  void options.agentResumeSessionIdVerified
  void options.agentLaunchMode

  return options.kind === 'agent'
}

export function shouldAwaitRestoredAgentVisibleOutput(options: {
  kind: WorkspaceNodeKind
  agentResumeSessionIdVerified: boolean
  agentLaunchMode: AgentLaunchMode | null
}): boolean {
  void options.agentResumeSessionIdVerified
  void options.agentLaunchMode

  return options.kind === 'agent'
}

export function shouldRequirePostGeometrySnapshotOutput(options: {
  kind: WorkspaceNodeKind
  isLiveSessionReattach: boolean
  agentResumeSessionIdVerified: boolean
  agentLaunchMode: AgentLaunchMode | null
}): boolean {
  void options.agentResumeSessionIdVerified
  void options.agentLaunchMode

  return options.kind === 'agent' && !options.isLiveSessionReattach
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
    }) && options.baselineSource === 'placeholder_snapshot'
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

type VisibleOutputCheckHandle = number

export function createRestoredAgentVisibleOutputObserver({
  hasVisibleOutput,
  onReady,
  scheduleCheck = callback => window.setTimeout(callback, 50),
  cancelCheck = handle => {
    window.clearTimeout(handle)
  },
  maxChecks = 200,
  meaningfulOutputGraceChecks = 20,
}: {
  hasVisibleOutput: () => boolean
  onReady: () => void
  scheduleCheck?: (callback: () => void) => VisibleOutputCheckHandle
  cancelCheck?: (handle: VisibleOutputCheckHandle) => void
  maxChecks?: number
  meaningfulOutputGraceChecks?: number
}) {
  let isWaiting = false
  let checkHandle: VisibleOutputCheckHandle | null = null
  let checkCount = 0
  let meaningfulOutputObservedAtCheck: number | null = null

  const cancelScheduledCheck = (): void => {
    if (checkHandle === null) {
      return
    }

    cancelCheck(checkHandle)
    checkHandle = null
  }

  const markReady = (): void => {
    if (!isWaiting) {
      return
    }

    isWaiting = false
    cancelScheduledCheck()
    onReady()
  }

  const scheduleVisibleOutputCheck = (): void => {
    if (!isWaiting || checkHandle !== null) {
      return
    }

    if (checkCount >= maxChecks) {
      markReady()
      return
    }

    checkCount += 1
    checkHandle = scheduleCheck(() => {
      checkHandle = null
      if (!isWaiting) {
        return
      }

      if (hasVisibleOutput()) {
        markReady()
        return
      }

      if (
        meaningfulOutputObservedAtCheck !== null &&
        checkCount - meaningfulOutputObservedAtCheck >= meaningfulOutputGraceChecks
      ) {
        markReady()
        return
      }

      scheduleVisibleOutputCheck()
    })
  }

  return {
    beginWaiting: () => {
      isWaiting = true
      checkCount = 0
      meaningfulOutputObservedAtCheck = null
      if (hasVisibleOutput()) {
        markReady()
        return
      }

      scheduleVisibleOutputCheck()
    },
    notifyOutputObserved: (data: string) => {
      if (!isWaiting) {
        return
      }

      if (hasVisibleOutput()) {
        markReady()
        return
      }

      if (containsMeaningfulTerminalDisplayContent(data)) {
        meaningfulOutputObservedAtCheck ??= checkCount
        scheduleVisibleOutputCheck()
      }
    },
    notifyWriteCommitted: (data?: string) => {
      if (!isWaiting) {
        return
      }

      if (
        hasVisibleOutput() ||
        (typeof data === 'string' && containsMeaningfulTerminalDisplayContent(data))
      ) {
        markReady()
        return
      }

      scheduleVisibleOutputCheck()
    },
    stopWaiting: () => {
      isWaiting = false
      cancelScheduledCheck()
    },
    dispose: () => {
      isWaiting = false
      cancelScheduledCheck()
    },
  }
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
  minAppliedSeqExclusive = null,
  requireMeaningfulSerializedScreen = false,
  requestSnapshot = requestPresentationSnapshot,
  wait = attempt =>
    new Promise<void>(resolve => {
      window.setTimeout(resolve, Math.min(50 + attempt * 25, 150))
    }),
  maxAttempts = 8,
}: {
  sessionId: string
  expectedGeometry: { cols: number; rows: number } | null
  minAppliedSeqExclusive?: number | null
  requireMeaningfulSerializedScreen?: boolean
  requestSnapshot?: (sessionId: string) => Promise<PresentationSnapshotTerminalResult | null>
  wait?: (attempt: number) => Promise<void>
  maxAttempts?: number
}): Promise<PresentationSnapshotTerminalResult | null> {
  const minAppliedSeq =
    typeof minAppliedSeqExclusive === 'number' && Number.isFinite(minAppliedSeqExclusive)
      ? Math.max(0, Math.floor(minAppliedSeqExclusive))
      : null

  if (expectedGeometry === null && minAppliedSeq === null && !requireMeaningfulSerializedScreen) {
    return await requestSnapshot(sessionId)
  }

  const attemptRequest = async (
    attempt: number,
    bestSequenceFenceSnapshot: PresentationSnapshotTerminalResult | null,
  ): Promise<PresentationSnapshotTerminalResult | null> => {
    if (attempt >= maxAttempts) {
      return bestSequenceFenceSnapshot
    }

    const snapshot = await requestSnapshot(sessionId)
    if (!snapshot) {
      if (attempt < maxAttempts - 1) {
        await wait(attempt)
      }

      return attemptRequest(attempt + 1, bestSequenceFenceSnapshot)
    }

    const hasExpectedGeometry =
      expectedGeometry === null ||
      (snapshot.cols === expectedGeometry.cols && snapshot.rows === expectedGeometry.rows)
    const hasRequiredOutput = minAppliedSeq === null || snapshot.appliedSeq > minAppliedSeq
    const hasRequiredScreen =
      !requireMeaningfulSerializedScreen ||
      containsMeaningfulTerminalDisplayContent(snapshot.serializedScreen)
    const nextSequenceFenceSnapshot =
      hasExpectedGeometry && hasRequiredOutput ? snapshot : bestSequenceFenceSnapshot

    if (hasExpectedGeometry && hasRequiredOutput && hasRequiredScreen) {
      return snapshot
    }

    if (attempt < maxAttempts - 1) {
      await wait(attempt)
    }

    return attemptRequest(attempt + 1, nextSequenceFenceSnapshot)
  }

  return attemptRequest(0, null)
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
  commitInitialGeometry: (
    baselineSnapshot: PresentationSnapshotTerminalResult | null,
  ) => Promise<{ cols: number; rows: number; changed: boolean } | null>
  requirePostGeometrySnapshotOutput?: boolean
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
        .then(async () => {
          const baselineSnapshot = await preAttachPresentationSnapshotPromise
          return await options.commitInitialGeometry(baselineSnapshot)
        })
        .catch(() => null)
  const presentationSnapshotPromise = options.isLiveSessionReattach
    ? preAttachPresentationSnapshotPromise
    : Promise.all([preAttachPresentationSnapshotPromise, initialGeometryCommitPromise]).then(
        ([baselineSnapshot, initialGeometry]) => {
          const baselineHasMeaningfulScreen =
            baselineSnapshot !== null &&
            containsMeaningfulTerminalDisplayContent(baselineSnapshot.serializedScreen)
          const shouldRequireFreshMeaningfulScreen =
            options.requirePostGeometrySnapshotOutput === true &&
            (initialGeometry?.changed === true || !baselineHasMeaningfulScreen)

          return requestPresentationSnapshotAfterGeometry({
            sessionId: options.sessionId,
            expectedGeometry: initialGeometry
              ? { cols: initialGeometry.cols, rows: initialGeometry.rows }
              : null,
            minAppliedSeqExclusive: shouldRequireFreshMeaningfulScreen
              ? (baselineSnapshot?.appliedSeq ?? 0)
              : null,
            requireMeaningfulSerializedScreen: shouldRequireFreshMeaningfulScreen,
            maxAttempts: shouldRequireFreshMeaningfulScreen ? 80 : 8,
          })
        },
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
  scheduleWebglCanvasTransformCleanup: () => void
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
    scheduleWebglCanvasTransformCleanup: options.scheduleWebglCanvasTransformCleanup,
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
