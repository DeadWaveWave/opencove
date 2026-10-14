/**
 * Status pill colors. Status hues appear only in pills and signals, always with text; waiting is
 * yellow and failed is red, kept apart from the plan family's orange.
 */
import { mixOver, toCss, type Rgb } from './oklch'
import type { GeneratedTheme } from './themeGenerator'

/** Color roles, not states: standby, exited and stopped all read as neutral. */
export const PILL_TONES = ['working', 'waiting', 'neutral', 'failed'] as const
export type PillTone = (typeof PILL_TONES)[number]

export interface PillColors {
  surface: Rgb
  text: Rgb
}

/**
 * Pills are opaque: each tint is pre-composited over the window frame, so whatever glows behind
 * the glass cannot lower the text contrast.
 */
export function statusPillColors(theme: GeneratedTheme): Record<PillTone, PillColors> {
  const dark = theme.input.appearance === 'dark'
  const { accent, amber, red, neutral } = theme
  const frame = dark ? neutral[1]! : neutral[0]!
  const tint = (color: Rgb, alpha: number) => mixOver(color, alpha, frame)
  return {
    working: { surface: tint(accent[8]!, dark ? 0.18 : 0.14), text: accent[10]! },
    waiting: { surface: tint(amber[8]!, dark ? 0.18 : 0.16), text: amber[10]! },
    neutral: { surface: neutral[3]!, text: neutral[10]! },
    failed: { surface: tint(red[8]!, dark ? 0.18 : 0.12), text: red[10]! },
  }
}

export function statusPillTokens(theme: GeneratedTheme): Record<string, string> {
  return Object.fromEntries(
    Object.entries(statusPillColors(theme)).flatMap(([tone, colors]) => [
      [`--cove-status-${tone}-surface`, toCss(colors.surface)],
      [`--cove-status-${tone}-text`, toCss(colors.text)],
    ]),
  )
}
