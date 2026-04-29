import type { Terminal } from '@xterm/xterm'
import type { TerminalDiagnosticsLogInput } from '@shared/contracts/dto'
import { hasVisibleTerminalBufferContent } from './terminalRuntimeDiagnostics'
import { createRestoredAgentVisibleOutputObserver } from './useTerminalRuntimeSession.support'

type RevealReason = 'hydration_revealed' | 'visible_output'

export function createRestoredAgentVisibilityGate({
  terminal,
  shouldAwaitAgentVisibleOutput,
  shouldGateInitialUserInput,
  isDisposed,
  markHydrated,
  protectVisibleBaseline,
  scheduleTranscriptSync,
  reportThemeMode,
  releaseBufferedUserInput,
  log,
}: {
  terminal: Terminal
  shouldAwaitAgentVisibleOutput: boolean
  shouldGateInitialUserInput: boolean
  isDisposed: () => boolean
  markHydrated: () => void
  protectVisibleBaseline: () => void
  scheduleTranscriptSync: () => void
  reportThemeMode: () => void
  releaseBufferedUserInput: () => void
  log: (event: string, details?: TerminalDiagnosticsLogInput['details']) => void
}) {
  let isAwaitingAgentVisibleOutput = false
  const hasVisibleOutput = () => hasVisibleTerminalBufferContent(terminal)
  const revealRuntimeTerminal = (reason: RevealReason): void => {
    if (isDisposed()) {
      return
    }

    const wasAwaitingAgentVisibleOutput = isAwaitingAgentVisibleOutput
    isAwaitingAgentVisibleOutput = false
    visibleOutputObserver.stopWaiting()
    if (shouldAwaitAgentVisibleOutput) {
      protectVisibleBaseline()
    }
    markHydrated()
    scheduleTranscriptSync()
    reportThemeMode()
    if (wasAwaitingAgentVisibleOutput || reason !== 'hydration_revealed') {
      log('agent-visible-output-ready', { reason })
    }
    if (shouldGateInitialUserInput) {
      releaseBufferedUserInput()
    }
  }
  const visibleOutputObserver = createRestoredAgentVisibleOutputObserver({
    hasVisibleOutput,
    onReady: () => {
      revealRuntimeTerminal('visible_output')
    },
  })

  return {
    revealAfterHydration: () => {
      if (isDisposed()) {
        return
      }

      if (shouldAwaitAgentVisibleOutput && !hasVisibleOutput()) {
        isAwaitingAgentVisibleOutput = true
        visibleOutputObserver.beginWaiting()
        scheduleTranscriptSync()
        reportThemeMode()
        log('agent-visible-output-wait', { reason: 'empty_hydration_baseline' })
        return
      }

      revealRuntimeTerminal('hydration_revealed')
    },
    notifyOutputObserved: (data: string) => {
      visibleOutputObserver.notifyOutputObserved(data)
    },
    notifyWriteCommitted: (data?: string) => {
      if (isAwaitingAgentVisibleOutput) {
        visibleOutputObserver.notifyWriteCommitted(data)
      }
    },
    notifyReplayWriteCommitted: () => {
      scheduleTranscriptSync()
      if (isAwaitingAgentVisibleOutput) {
        visibleOutputObserver.notifyWriteCommitted()
      }
    },
    dispose: () => {
      visibleOutputObserver.dispose()
    },
  }
}
