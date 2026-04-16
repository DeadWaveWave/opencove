import { useEffect } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import type { WorkspaceNodeKind } from '../../types'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TerminalThemeMode } from './theme'
import { writeTerminalAsync } from './writeTerminal'
import { createMountedXtermSession, type XtermSession } from './xtermSession'
import { registerWebglPixelSnappingMutationObserver } from './registerWebglPixelSnappingMutationObserver'
import type { TerminalRendererKind } from './useWebglPixelSnappingScheduler'
import {
  hasRecentTerminalUserInteraction,
  registerTerminalUserInteractionWindow,
} from './userInteractionWindow'

export function useTerminalPlaceholderSession({
  nodeId,
  sessionId,
  kind,
  scrollback,
  terminalProvider,
  terminalThemeMode,
  isTestEnvironment,
  containerRef,
  terminalRef,
  fitAddonRef,
  suppressPtyResizeRef,
  syncTerminalSize,
  applyTerminalTheme,
  bindSearchAddonToFind,
  isTerminalHydratedRef,
  setIsTerminalHydrated,
  scheduleTranscriptSync,
  shouldRestoreTerminalFocusRef,
  latestSessionIdRef,
  preservedXtermSessionRef,
  recentUserInteractionAtRef,
  pendingUserInputBufferRef,
  activeRendererKindRef,
  scheduleWebglPixelSnapping,
  cancelWebglPixelSnapping,
  setRendererKindAndApply,
}: {
  nodeId: string
  sessionId: string
  kind: WorkspaceNodeKind
  scrollback: string | null
  terminalProvider: AgentProvider | null
  terminalThemeMode: TerminalThemeMode
  isTestEnvironment: boolean
  containerRef: { current: HTMLDivElement | null }
  terminalRef: { current: Terminal | null }
  fitAddonRef: { current: FitAddon | null }
  suppressPtyResizeRef: { current: boolean }
  syncTerminalSize: () => void
  applyTerminalTheme: () => void
  bindSearchAddonToFind: (addon: SearchAddon) => () => void
  isTerminalHydratedRef: { current: boolean }
  setIsTerminalHydrated: (hydrated: boolean) => void
  scheduleTranscriptSync: () => void
  shouldRestoreTerminalFocusRef: { current: boolean }
  latestSessionIdRef: { current: string }
  preservedXtermSessionRef: { current: XtermSession | null }
  recentUserInteractionAtRef: { current: number }
  pendingUserInputBufferRef: {
    current: Array<{ data: string; encoding: 'utf8' | 'binary' }>
  }
  activeRendererKindRef: { current: TerminalRendererKind }
  scheduleWebglPixelSnapping: () => void
  cancelWebglPixelSnapping: () => void
  setRendererKindAndApply: (kind: TerminalRendererKind) => void
}): void {
  useEffect(() => {
    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId.length > 0) {
      return undefined
    }

    const normalizedScrollback = (scrollback ?? '').trim()
    if (normalizedScrollback.length === 0) {
      return undefined
    }
    const shouldHandoffToRuntime = (): boolean => latestSessionIdRef.current.trim().length > 0

    const windowsPty = window.opencoveApi.meta?.windowsPty ?? null
    const diagnosticsEnabled =
      window.opencoveApi.meta?.enableTerminalDiagnostics === true ||
      window.opencoveApi.meta?.enableTerminalInputDiagnostics === true
    const logTerminalDiagnostics =
      window.opencoveApi.debug?.logTerminalDiagnostics ?? (() => undefined)

    suppressPtyResizeRef.current = false
    const session = createMountedXtermSession({
      nodeId,
      ownerId: `${nodeId}:placeholder`,
      sessionIdForDiagnostics: '',
      nodeKindForDiagnostics: kind === 'agent' ? 'agent' : 'terminal',
      titleForDiagnostics: 'placeholder',
      terminalProvider,
      terminalThemeMode,
      isTestEnvironment,
      container: containerRef.current,
      initialDimensions: null,
      windowsPty,
      cursorBlink: false,
      disableStdin: false,
      bindSearchAddonToFind,
      syncTerminalSize,
      diagnosticsEnabled,
      logTerminalDiagnostics,
    })
    terminalRef.current = session.terminal
    fitAddonRef.current = session.fitAddon
    setRendererKindAndApply(session.renderer.kind)
    const disposePositionObserver = registerWebglPixelSnappingMutationObserver({
      container: containerRef.current,
      isWebglRenderer: () => activeRendererKindRef.current === 'webgl',
      scheduleWebglPixelSnapping,
    })
    const disposeInteractionWindow = registerTerminalUserInteractionWindow({
      container: containerRef.current,
      interactionAtRef: recentUserInteractionAtRef,
    })
    if (shouldRestoreTerminalFocusRef.current) {
      shouldRestoreTerminalFocusRef.current = false
      session.terminal.focus()
    }

    const capturePlaceholderInput = (data: string, encoding: 'utf8' | 'binary'): void => {
      if (data.length === 0) {
        return
      }

      if (
        data.startsWith('\u001b') &&
        !hasRecentTerminalUserInteraction(recentUserInteractionAtRef)
      ) {
        return
      }

      pendingUserInputBufferRef.current.push({ data, encoding })
    }
    const dataDisposable = session.terminal.onData(data => {
      capturePlaceholderInput(data, 'utf8')
    })
    const binaryDisposable = session.terminal.onBinary(data => {
      capturePlaceholderInput(data, 'binary')
    })

    let isDisposed = false
    void (async () => {
      try {
        await writeTerminalAsync(session.terminal, scrollback ?? '')
      } catch {
        // placeholder is best-effort; treat write failures as hydrated to unblock UI
      }

      if (isDisposed) {
        return
      }

      isTerminalHydratedRef.current = true
      setIsTerminalHydrated(true)
      scheduleTranscriptSync()
      session.diagnostics.logHydrated({
        rawSnapshotLength: (scrollback ?? '').length,
        bufferedExitCode: null,
      })
    })()

    const handleThemeChange = () => {
      if (terminalThemeMode !== 'sync-with-ui') {
        return
      }
      applyTerminalTheme()
      session.renderer.clearTextureAtlas()
      syncTerminalSize()
    }
    window.addEventListener('opencove-theme-changed', handleThemeChange)

    return () => {
      isDisposed = true
      dataDisposable.dispose()
      binaryDisposable.dispose()
      window.removeEventListener('opencove-theme-changed', handleThemeChange)
      disposeInteractionWindow()
      disposePositionObserver()
      if (shouldHandoffToRuntime()) {
        preservedXtermSessionRef.current = session
        return
      }

      session.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      activeRendererKindRef.current = 'dom'
      cancelWebglPixelSnapping()
    }
  }, [
    applyTerminalTheme,
    latestSessionIdRef,
    activeRendererKindRef,
    bindSearchAddonToFind,
    cancelWebglPixelSnapping,
    fitAddonRef,
    isTerminalHydratedRef,
    isTestEnvironment,
    kind,
    nodeId,
    recentUserInteractionAtRef,
    scheduleTranscriptSync,
    scrollback,
    sessionId,
    setIsTerminalHydrated,
    suppressPtyResizeRef,
    syncTerminalSize,
    preservedXtermSessionRef,
    pendingUserInputBufferRef,
    scheduleWebglPixelSnapping,
    setRendererKindAndApply,
    terminalProvider,
    terminalRef,
    terminalThemeMode,
    containerRef,
    shouldRestoreTerminalFocusRef,
  ])
}
