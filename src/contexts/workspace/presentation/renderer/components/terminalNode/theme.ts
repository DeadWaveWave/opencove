import type { ResolvedUiTheme } from '@shared/contracts/dto'

export type TerminalThemeMode = 'sync-with-ui' | 'dark'

const TERMINAL_THEME_DEFAULTS: Record<
  ResolvedUiTheme,
  {
    background: string
    foreground: string
    cursor: string
    selectionBackground: string
  }
> = {
  dark: {
    background: '#0a0f1d',
    foreground: '#d6e4ff',
    cursor: '#d6e4ff',
    selectionBackground: 'rgba(94, 156, 255, 0.35)',
  },
  light: {
    background: '#fbfcff',
    foreground: 'rgba(17, 24, 39, 0.92)',
    cursor: 'rgba(17, 24, 39, 0.92)',
    selectionBackground: 'rgba(94, 156, 255, 0.24)',
  },
}

export function resolveActiveUiTheme(): ResolvedUiTheme {
  return document.documentElement.dataset.coveTheme === 'light' ? 'light' : 'dark'
}

export function resolveTerminalUiTheme(mode: TerminalThemeMode): ResolvedUiTheme {
  return mode === 'dark' ? 'dark' : resolveActiveUiTheme()
}

export function resolveTerminalTheme(mode: TerminalThemeMode = 'sync-with-ui') {
  const resolvedTheme = resolveTerminalUiTheme(mode)
  const defaults = TERMINAL_THEME_DEFAULTS[resolvedTheme]

  if (mode === 'dark') {
    return { ...defaults }
  }

  const readRootCssVar = (name: string, fallback: string): string => {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return value.length > 0 ? value : fallback
  }

  return {
    background: readRootCssVar('--cove-terminal-background', defaults.background),
    foreground: readRootCssVar('--cove-terminal-foreground', defaults.foreground),
    cursor: readRootCssVar('--cove-terminal-cursor', defaults.cursor),
    selectionBackground: readRootCssVar('--cove-terminal-selection', defaults.selectionBackground),
  }
}
