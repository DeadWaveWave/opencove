import {
  resolveTerminalTransparentBackground,
  type TerminalBackgroundMode,
} from '@contexts/settings/domain/terminalBackgroundSettings'

/**
 * Whether terminals open xterm with a transparent background. Changing it recreates their xterm
 * instances, so it follows only the setting and platform; themes and Reduce Transparency decide
 * in CSS what shows behind the text.
 */
export function useTerminalTransparentBackground(mode: TerminalBackgroundMode): boolean {
  return resolveTerminalTransparentBackground({
    mode,
    platform: window.opencoveApi?.meta?.platform ?? null,
  })
}
