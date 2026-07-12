import type { Terminal } from '@xterm/xterm'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { createOpenCodeTuiThemeBridge } from './opencodeTuiThemeBridge'
import {
  getOrCreateTerminalAppearanceOwner,
  resolveCurrentTerminalAppearanceValue,
  type TerminalAppearanceTheme,
} from './terminalAppearance'
import type { TerminalThemeMode } from './theme'

export function createOptionalOpenCodeThemeBridge(options: {
  terminalProvider: AgentProvider | null
  terminal: Terminal
  ptyWriteQueue: {
    enqueue: (data: string, encoding?: 'utf8' | 'binary') => void
    flush: () => void
  }
  terminalThemeMode: TerminalThemeMode
}) {
  if (options.terminalProvider !== 'opencode') {
    return null
  }

  const currentTheme = (
    options.terminal.options as unknown as {
      theme?: Partial<TerminalAppearanceTheme>
    }
  ).theme
  const appearanceOwner = getOrCreateTerminalAppearanceOwner(
    options.terminal,
    resolveCurrentTerminalAppearanceValue({
      terminalThemeMode: options.terminalThemeMode,
      xtermTheme: currentTheme,
    }),
  )

  return createOpenCodeTuiThemeBridge({
    terminal: options.terminal,
    ptyWriteQueue: options.ptyWriteQueue,
    terminalThemeMode: options.terminalThemeMode,
    getAppliedAppearance: appearanceOwner.getAppliedSnapshot,
    subscribeAppliedAppearance: appearanceOwner.subscribeApplied,
  })
}
