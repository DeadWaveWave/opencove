import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import {
  containsDestructiveTerminalDisplayControlSequence,
  shouldDeferHydratedTerminalRedrawChunk,
} from './hydrationReplacement'
import { formatTerminalDataHeadHex } from './terminalRuntimeDiagnostics'
import type { createTerminalHydrationRouter } from './hydrationRouter'
import type { createRestoredAgentVisibilityGate } from './restoredAgentVisibilityGate'
import type { registerTerminalDiagnostics } from './registerDiagnostics'
import type { createOptionalOpenCodeThemeBridge } from './useTerminalRuntimeSession.support'
import type { TerminalRendererRecoveryRequest } from './runtimeRendererHealth'

type PtyEventHub = ReturnType<typeof getPtyEventHub>
type TerminalDiagnostics = ReturnType<typeof registerTerminalDiagnostics>
type RestoredAgentVisibilityGate = ReturnType<typeof createRestoredAgentVisibilityGate>
type TerminalHydrationRouter = ReturnType<typeof createTerminalHydrationRouter>
type OpenCodeThemeBridge = ReturnType<typeof createOptionalOpenCodeThemeBridge>

export function subscribeRuntimeTerminalEvents({
  ptyEventHub,
  sessionId,
  openCodeThemeBridge,
  diagnosticsEnabled,
  terminalDiagnostics,
  restoredAgentVisibilityGate,
  hydrationRouter,
  lastCommittedPtySizeRef,
  terminal,
  syncTerminalSize,
  scheduleTranscriptSync,
  requestTerminalRendererRecovery,
}: {
  ptyEventHub: PtyEventHub
  sessionId: string
  openCodeThemeBridge: OpenCodeThemeBridge
  diagnosticsEnabled: boolean
  terminalDiagnostics: TerminalDiagnostics
  restoredAgentVisibilityGate: RestoredAgentVisibilityGate
  hydrationRouter: TerminalHydrationRouter
  lastCommittedPtySizeRef: MutableRefObject<{ cols: number; rows: number } | null>
  terminal: Terminal
  syncTerminalSize: () => void
  scheduleTranscriptSync: () => void
  requestTerminalRendererRecovery: (request: TerminalRendererRecoveryRequest) => void
}): () => void {
  const unsubscribeData = ptyEventHub.onSessionData(sessionId, event => {
    openCodeThemeBridge?.handlePtyOutputChunk(event.data)
    if (diagnosticsEnabled) {
      terminalDiagnostics.log('pty-data', {
        seq: event.seq ?? null,
        dataLength: event.data.length,
        dataStartsWithEsc: event.data.startsWith('\u001b'),
        dataHeadHex: formatTerminalDataHeadHex(event.data),
        containsDestructive: containsDestructiveTerminalDisplayControlSequence(event.data),
        shouldDeferHydratedRedraw: shouldDeferHydratedTerminalRedrawChunk(event.data),
      })
    }
    restoredAgentVisibilityGate.notifyOutputObserved(event.data)
    hydrationRouter.handleDataChunk(event.data, { seq: event.seq ?? null })
  })
  const unsubscribeExit = ptyEventHub.onSessionExit(sessionId, event => {
    hydrationRouter.handleExit(event.exitCode)
  })
  const unsubscribeGeometry = ptyEventHub.onSessionGeometry(sessionId, event => {
    lastCommittedPtySizeRef.current = { cols: event.cols, rows: event.rows }
    if (terminal.cols !== event.cols || terminal.rows !== event.rows) {
      terminal.resize(event.cols, event.rows)
    }
    syncTerminalSize()
    scheduleTranscriptSync()
  })
  const unsubscribeResync = ptyEventHub.onSessionResync(sessionId, () => {
    requestTerminalRendererRecovery({
      reason: 'stream_resync',
      trigger: 'resync_event',
      forceDom: false,
    })
  })

  return () => {
    unsubscribeData()
    unsubscribeExit()
    unsubscribeGeometry()
    unsubscribeResync()
  }
}
