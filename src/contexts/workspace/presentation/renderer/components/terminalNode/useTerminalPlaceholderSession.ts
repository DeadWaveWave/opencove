import { useEffect } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { WorkspaceNodeKind } from '../../types'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { resolveTerminalTheme, resolveTerminalUiTheme, type TerminalThemeMode } from './theme'
import { activatePreferredTerminalRenderer } from './preferredRenderer'
import { patchXtermMouseServiceWithRetry } from './patchXtermMouseService'
import { registerTerminalHitTargetCursorScope } from './hitTargetCursorScope'
import { DEFAULT_TERMINAL_FONT_FAMILY } from './constants'
import { resolveInitialTerminalDimensions } from './initialDimensions'
import { registerTerminalSelectionTestHandle } from './testHarness'
import { registerTerminalDiagnostics } from './registerDiagnostics'

async function writeTerminal(terminal: Terminal, data: string): Promise<void> {
  if (data.length === 0) {
    return
  }

  await new Promise<void>(resolve => {
    terminal.write(data, () => {
      resolve()
    })
  })
}

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

    const initialTerminalTheme = resolveTerminalTheme(terminalThemeMode)
    const resolvedTerminalUiTheme = resolveTerminalUiTheme(terminalThemeMode)
    const windowsPty = window.opencoveApi.meta?.windowsPty ?? null
    const diagnosticsEnabled =
      window.opencoveApi.meta?.enableTerminalDiagnostics === true ||
      window.opencoveApi.meta?.enableTerminalInputDiagnostics === true
    const logTerminalDiagnostics =
      window.opencoveApi.debug?.logTerminalDiagnostics ?? (() => undefined)

    suppressPtyResizeRef.current = false
    const initialDimensions = resolveInitialTerminalDimensions(null)
    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      theme: initialTerminalTheme,
      allowProposedApi: true,
      convertEol: true,
      scrollback: 5000,
      ...(windowsPty ? { windowsPty } : {}),
      ...(initialDimensions ?? {}),
    })
    const fitAddon = new FitAddon()
    const serializeAddon = new SerializeAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(serializeAddon)
    let activeRenderer = activatePreferredTerminalRenderer(terminal, terminalProvider)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const disposeTerminalFind =
      typeof (terminal as unknown as { onWriteParsed?: unknown }).onWriteParsed === 'function'
        ? (() => {
            const searchAddon = new SearchAddon()
            terminal.loadAddon(searchAddon)
            return bindSearchAddonToFind(searchAddon)
          })()
        : () => undefined

    let disposeTerminalSelectionTestHandle: () => void = () => undefined
    let cancelMouseServicePatch: () => void = () => undefined
    let disposeTerminalHitTargetCursorScope: () => void = () => undefined

    if (containerRef.current) {
      terminal.open(containerRef.current)
      containerRef.current.setAttribute('data-cove-terminal-theme', resolvedTerminalUiTheme)
      cancelMouseServicePatch = patchXtermMouseServiceWithRetry(terminal)
      disposeTerminalHitTargetCursorScope = registerTerminalHitTargetCursorScope({
        container: containerRef.current,
        ownerId: `${nodeId}:placeholder`,
      })
      if (isTestEnvironment) {
        disposeTerminalSelectionTestHandle = registerTerminalSelectionTestHandle(nodeId, terminal)
      }
      activeRenderer.clearTextureAtlas()
      syncTerminalSize()
      requestAnimationFrame(syncTerminalSize)
    }

    const terminalDiagnostics = registerTerminalDiagnostics({
      enabled: diagnosticsEnabled,
      emit: logTerminalDiagnostics,
      nodeId,
      sessionId: '',
      nodeKind: kind === 'agent' ? 'agent' : 'terminal',
      title: kind === 'agent' ? 'placeholder' : 'placeholder',
      terminal,
      container: containerRef.current,
      rendererKind: activeRenderer.kind,
      terminalThemeMode,
      windowsPty,
    })

    let isDisposed = false
    void (async () => {
      try {
        await writeTerminal(terminal, scrollback ?? '')
      } catch {
        // placeholder is best-effort; treat write failures as hydrated to unblock UI
      }

      if (isDisposed) {
        return
      }

      isTerminalHydratedRef.current = true
      setIsTerminalHydrated(true)
      scheduleTranscriptSync()
      terminalDiagnostics.logHydrated({
        rawSnapshotLength: (scrollback ?? '').length,
        bufferedExitCode: null,
      })
    })()

    const handleThemeChange = () => {
      if (terminalThemeMode !== 'sync-with-ui') {
        return
      }
      applyTerminalTheme()
      activeRenderer.clearTextureAtlas()
      syncTerminalSize()
    }
    window.addEventListener('opencove-theme-changed', handleThemeChange)

    return () => {
      isDisposed = true
      cancelMouseServicePatch()
      disposeTerminalHitTargetCursorScope()
      activeRenderer.dispose()
      terminalDiagnostics.dispose()
      window.removeEventListener('opencove-theme-changed', handleThemeChange)
      disposeTerminalSelectionTestHandle()
      disposeTerminalFind()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [
    applyTerminalTheme,
    bindSearchAddonToFind,
    containerRef,
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
  ])
}
