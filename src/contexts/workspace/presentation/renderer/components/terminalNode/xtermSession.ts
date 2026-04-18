import { FitAddon } from '@xterm/addon-fit'
import { LigaturesAddon } from '@xterm/addon-ligatures'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TerminalDiagnosticsLogInput, TerminalWindowsPty } from '@shared/contracts/dto'
import { DEFAULT_TERMINAL_FONT_FAMILY } from './constants'
import { FilePathLinkProvider } from './linkProviders/file-path-link-provider'
import { UrlLinkProvider } from './linkProviders/url-link-provider'
import { registerTerminalSelectionTestHandle } from './testHarness'
import { patchXtermMouseServiceWithRetry } from './patchXtermMouseService'
import { registerTerminalHitTargetCursorScope } from './hitTargetCursorScope'
import { registerWebglPixelSnappingMutationObserver } from './registerWebglPixelSnappingMutationObserver'
import { activatePreferredTerminalRenderer, type ActiveTerminalRenderer } from './preferredRenderer'
import { registerTerminalDiagnostics } from './registerDiagnostics'
import { resolveTerminalTheme, resolveTerminalUiTheme, type TerminalThemeMode } from './theme'

type TerminalDiagnosticsHandle = ReturnType<typeof registerTerminalDiagnostics>

export interface XtermSession {
  terminal: Terminal
  fitAddon: FitAddon
  serializeAddon: SerializeAddon
  renderer: ActiveTerminalRenderer
  diagnostics: TerminalDiagnosticsHandle
  dispose: () => void
}

export function createMountedXtermSession({
  nodeId,
  ownerId,
  sessionIdForDiagnostics,
  nodeKindForDiagnostics,
  titleForDiagnostics,
  terminalProvider,
  terminalThemeMode,
  isTestEnvironment,
  container,
  initialDimensions,
  windowsPty,
  cursorBlink,
  disableStdin,
  fontSize,
  bindSearchAddonToFind,
  syncTerminalSize,
  diagnosticsEnabled,
  logTerminalDiagnostics,
  onRendererKindResolved,
  scheduleWebglPixelSnapping,
}: {
  nodeId: string
  ownerId: string
  sessionIdForDiagnostics: string
  nodeKindForDiagnostics: 'terminal' | 'agent'
  titleForDiagnostics: string
  terminalProvider: AgentProvider | null
  terminalThemeMode: TerminalThemeMode
  isTestEnvironment: boolean
  container: HTMLDivElement | null
  initialDimensions: { cols: number; rows: number } | null
  windowsPty: TerminalWindowsPty | null
  cursorBlink: boolean
  disableStdin: boolean
  fontSize: number
  bindSearchAddonToFind: (addon: SearchAddon) => () => void
  syncTerminalSize: () => void
  diagnosticsEnabled: boolean
  logTerminalDiagnostics: (payload: TerminalDiagnosticsLogInput) => void
  onRendererKindResolved?: (kind: ActiveTerminalRenderer['kind']) => void
  scheduleWebglPixelSnapping?: () => void
}): XtermSession {
  const initialTerminalTheme = resolveTerminalTheme(terminalThemeMode)
  const resolvedTerminalUiTheme = resolveTerminalUiTheme(terminalThemeMode)

  const terminal = new Terminal({
    cursorBlink,
    ...(disableStdin ? { disableStdin: true } : {}),
    fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize,
    theme: initialTerminalTheme,
    allowProposedApi: true,
    convertEol: true,
    scrollback: 5000,
    ...(windowsPty ? { windowsPty } : {}),
    ...(initialDimensions ?? {}),
  })
  const fitAddon = new FitAddon()
  const serializeAddon = new SerializeAddon()
  const unicode11Addon = new Unicode11Addon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(serializeAddon)
  try {
    terminal.loadAddon(unicode11Addon)
    unicode11Addon.activate(terminal)
  } catch {
    // Degrade gracefully in environments without unicode11 support (e.g., test mocks)
  }

  let renderer: ActiveTerminalRenderer = {
    kind: 'dom',
    clearTextureAtlas: () => undefined,
    dispose: () => undefined,
  }

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
  let disposeWebglPixelSnappingObserver: () => void = () => undefined

  if (container) {
    terminal.open(container)
    renderer = activatePreferredTerminalRenderer(terminal, terminalProvider, {
      onRendererKindChange: kind => {
        onRendererKindResolved?.(kind)
        scheduleWebglPixelSnapping?.()
      },
    })
    onRendererKindResolved?.(renderer.kind)
    try {
      const ligaturesAddon = new LigaturesAddon()
      terminal.loadAddon(ligaturesAddon)
    } catch {
      // Degrade gracefully in environments without ligatures support (e.g., test mocks)
    }
    terminal.registerLinkProvider(new UrlLinkProvider(terminal, (_, uri) => window.open(uri)))
    terminal.registerLinkProvider(
      new FilePathLinkProvider(terminal, (_, path) => window.open(path)),
    )
    container.setAttribute('data-cove-terminal-theme', resolvedTerminalUiTheme)
    cancelMouseServicePatch = patchXtermMouseServiceWithRetry(terminal)
    disposeTerminalHitTargetCursorScope = registerTerminalHitTargetCursorScope({
      container,
      ownerId,
    })
    disposeWebglPixelSnappingObserver = registerWebglPixelSnappingMutationObserver({
      container,
      isWebglRenderer: () => renderer.kind === 'webgl',
      scheduleWebglPixelSnapping: scheduleWebglPixelSnapping ?? (() => undefined),
    })
    if (isTestEnvironment) {
      disposeTerminalSelectionTestHandle = registerTerminalSelectionTestHandle(nodeId, terminal)
    }
    renderer.clearTextureAtlas()
    syncTerminalSize()
    requestAnimationFrame(syncTerminalSize)
    scheduleWebglPixelSnapping?.()
  } else {
    onRendererKindResolved?.(renderer.kind)
  }

  const diagnostics = registerTerminalDiagnostics({
    enabled: diagnosticsEnabled,
    emit: logTerminalDiagnostics,
    nodeId,
    sessionId: sessionIdForDiagnostics,
    nodeKind: nodeKindForDiagnostics,
    title: titleForDiagnostics,
    terminal,
    container,
    rendererKind: renderer.kind,
    terminalThemeMode,
    windowsPty,
  })

  return {
    terminal,
    fitAddon,
    serializeAddon,
    renderer,
    diagnostics,
    dispose: () => {
      cancelMouseServicePatch()
      disposeTerminalHitTargetCursorScope()
      disposeWebglPixelSnappingObserver()
      renderer.dispose()
      diagnostics.dispose()
      disposeTerminalSelectionTestHandle()
      disposeTerminalFind()
      terminal.dispose()
    },
  }
}
