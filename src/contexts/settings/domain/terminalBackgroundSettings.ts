/**
 * Whether terminals open their xterm with a transparent background, so their text can sit on the
 * window's reading plate. `auto` is transparent on macOS only: on Windows, text over a transparent
 * background drops from ClearType to grayscale anti-aliasing. What shows behind the text is the
 * theme's business (CSS): solid plates and Reduce Transparency keep the terminal colour.
 */
export const TERMINAL_BACKGROUND_MODES = ['auto', 'transparent', 'opaque'] as const
export type TerminalBackgroundMode = (typeof TERMINAL_BACKGROUND_MODES)[number]

export const DEFAULT_TERMINAL_BACKGROUND_MODE: TerminalBackgroundMode = 'auto'

export function isValidTerminalBackgroundMode(value: unknown): value is TerminalBackgroundMode {
  return (
    typeof value === 'string' && (TERMINAL_BACKGROUND_MODES as readonly string[]).includes(value)
  )
}

/** Only this decision recreates xterm, so it depends on the setting and the platform alone. */
export function resolveTerminalTransparentBackground({
  mode,
  platform,
}: {
  mode: TerminalBackgroundMode
  platform: string | null
}): boolean {
  return mode === 'transparent' || (mode === 'auto' && platform === 'darwin')
}
