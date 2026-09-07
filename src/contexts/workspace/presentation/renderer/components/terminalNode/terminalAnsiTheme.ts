import type { ResolvedUiTheme } from '@shared/contracts/dto'

export const TERMINAL_ANSI_THEME_ENTRIES = [
  ['black', '--cove-terminal-ansi-black'],
  ['red', '--cove-terminal-ansi-red'],
  ['green', '--cove-terminal-ansi-green'],
  ['yellow', '--cove-terminal-ansi-yellow'],
  ['blue', '--cove-terminal-ansi-blue'],
  ['magenta', '--cove-terminal-ansi-magenta'],
  ['cyan', '--cove-terminal-ansi-cyan'],
  ['white', '--cove-terminal-ansi-white'],
  ['brightBlack', '--cove-terminal-ansi-bright-black'],
  ['brightRed', '--cove-terminal-ansi-bright-red'],
  ['brightGreen', '--cove-terminal-ansi-bright-green'],
  ['brightYellow', '--cove-terminal-ansi-bright-yellow'],
  ['brightBlue', '--cove-terminal-ansi-bright-blue'],
  ['brightMagenta', '--cove-terminal-ansi-bright-magenta'],
  ['brightCyan', '--cove-terminal-ansi-bright-cyan'],
  ['brightWhite', '--cove-terminal-ansi-bright-white'],
] as const

export type TerminalAnsiThemeKey = (typeof TERMINAL_ANSI_THEME_ENTRIES)[number][0]
export type TerminalAnsiTheme = Partial<Record<TerminalAnsiThemeKey, string>>

/** Optional ANSI overrides travel inside the same snapshot as every other xterm color. */
export function readTerminalAnsiTheme(
  computedStyle: CSSStyleDeclaration,
  overrides?: TerminalAnsiTheme | null,
): TerminalAnsiTheme {
  const colors: TerminalAnsiTheme = {}
  for (const [key, variable] of TERMINAL_ANSI_THEME_ENTRIES) {
    const color = overrides?.[key] ?? computedStyle.getPropertyValue(variable).trim()
    if (color) {
      colors[key] = color
    }
  }
  return colors
}

export function terminalAnsiThemesEqual(a: TerminalAnsiTheme, b: TerminalAnsiTheme): boolean {
  return TERMINAL_ANSI_THEME_ENTRIES.every(([key]) => a[key] === b[key])
}

/** A forced dark terminal must not inherit the light UI's readable ANSI overrides. */
export function resolveTerminalAnsiScheme<T extends TerminalAnsiTheme>(
  theme: T,
  scheme: ResolvedUiTheme,
): T {
  const result = { ...theme }
  if (scheme === 'dark') {
    for (const [key] of TERMINAL_ANSI_THEME_ENTRIES) {
      delete result[key]
    }
  }
  return result
}
