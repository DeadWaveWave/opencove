import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { activatePreferredTerminalRenderer } from './preferredRenderer'
import { DEFAULT_TERMINAL_FONT_FAMILY } from './constants'

export function createTerminalRuntimePrimitives({
  bindSearchAddonToFind,
  initialDimensions,
  initialTerminalTheme,
  terminalProvider,
  windowsPty,
}: {
  bindSearchAddonToFind: (addon: SearchAddon) => () => void
  initialDimensions: { cols?: number; rows?: number } | null
  initialTerminalTheme: NonNullable<ConstructorParameters<typeof Terminal>[0]>['theme']
  terminalProvider: AgentProvider | null
  windowsPty: unknown
}): {
  activeRenderer: ReturnType<typeof activatePreferredTerminalRenderer>
  disposeTerminalFind: () => void
  fitAddon: FitAddon
  serializeAddon: SerializeAddon
  terminal: Terminal
} {
  const terminal = new Terminal({
    cursorBlink: true,
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
  const activeRenderer = activatePreferredTerminalRenderer(terminal, terminalProvider)
  const disposeTerminalFind =
    typeof (terminal as unknown as { onWriteParsed?: unknown }).onWriteParsed === 'function'
      ? (() => {
          const searchAddon = new SearchAddon()
          terminal.loadAddon(searchAddon)
          return bindSearchAddonToFind(searchAddon)
        })()
      : () => undefined

  return {
    activeRenderer,
    disposeTerminalFind,
    fitAddon,
    serializeAddon,
    terminal,
  }
}
