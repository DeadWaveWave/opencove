import type { ResolvedUiTheme } from '@shared/contracts/dto'

export function resolveActiveUiTheme(): ResolvedUiTheme {
  return document.documentElement.dataset.coveTheme === 'light' ? 'light' : 'dark'
}

export function resolveTerminalTheme() {
  const readRootCssVar = (name: string, fallback: string): string => {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return value.length > 0 ? value : fallback
  }

  return {
    background: readRootCssVar('--cove-terminal-background', '#0a0f1d'),
    foreground: readRootCssVar('--cove-terminal-foreground', '#d6e4ff'),
    cursor: readRootCssVar('--cove-terminal-cursor', '#d6e4ff'),
    selectionBackground: readRootCssVar('--cove-terminal-selection', 'rgba(94, 156, 255, 0.35)'),
  }
}
