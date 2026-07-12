import type { ResolvedUiTheme } from '@shared/contracts/dto'
import {
  isValidUiTheme,
  resolveUiThemeTerminalScheme,
  type UiTheme,
} from '@contexts/settings/domain/uiSettings'

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

export function resolveActiveUiThemeId(): UiTheme {
  const themeId = document.documentElement.dataset.coveThemeId
  if (isValidUiTheme(themeId)) {
    return themeId
  }
  return resolveActiveUiTheme()
}

export function resolveTerminalUiTheme(mode: TerminalThemeMode): ResolvedUiTheme {
  if (mode === 'dark') {
    return 'dark'
  }

  const uiScheme = resolveActiveUiTheme()
  return resolveUiThemeTerminalScheme(resolveActiveUiThemeId(), uiScheme)
}

export function resolveTerminalTheme(
  mode: TerminalThemeMode = 'sync-with-ui',
  scope: Element | null = null,
) {
  const readScope: Element = scope ?? document.documentElement
  return resolveTerminalThemeFromComputedStyle(mode, window.getComputedStyle(readScope))
}

export function resolveTerminalThemeFromComputedStyle(
  mode: TerminalThemeMode,
  computedStyle: CSSStyleDeclaration,
) {
  const resolvedTheme = resolveTerminalUiTheme(mode)
  const defaults = TERMINAL_THEME_DEFAULTS[resolvedTheme]

  const readCssVar = (name: string, fallback: string): string => {
    const value = computedStyle.getPropertyValue(name).trim()
    return value.length > 0 ? value : fallback
  }

  return {
    background: readCssVar('--cove-terminal-background', defaults.background),
    foreground: readCssVar('--cove-terminal-foreground', defaults.foreground),
    cursor: readCssVar('--cove-terminal-cursor', defaults.cursor),
    selectionBackground: readCssVar('--cove-terminal-selection', defaults.selectionBackground),
  }
}
