import { useEffect } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import type { WorkspaceNodeKind } from '../../types'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TerminalThemeMode } from './theme'
import { writeTerminalAsync } from './writeTerminal'
import { createMountedXtermSession } from './xtermSession'

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
      disableStdin: true,
      bindSearchAddonToFind,
      syncTerminalSize,
      diagnosticsEnabled,
      logTerminalDiagnostics,
    })
    terminalRef.current = session.terminal
    fitAddonRef.current = session.fitAddon
    if (shouldRestoreTerminalFocusRef.current) {
      shouldRestoreTerminalFocusRef.current = false
      session.terminal.focus()
    }

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
      window.removeEventListener('opencove-theme-changed', handleThemeChange)
      session.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [
    applyTerminalTheme,
    bindSearchAddonToFind,
    fitAddonRef,
    isTerminalHydratedRef,
    isTestEnvironment,
    kind,
    nodeId,
    scheduleTranscriptSync,
    scrollback,
    sessionId,
    setIsTerminalHydrated,
    suppressPtyResizeRef,
    syncTerminalSize,
    terminalProvider,
    terminalRef,
    terminalThemeMode,
    containerRef,
    shouldRestoreTerminalFocusRef,
  ])
}
