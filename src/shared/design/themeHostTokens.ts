/**
 * Host-only tokens for generated families. base.css still declares the standard theme's literal
 * colours; a family replaces every one of them so none shows through (enforced by the token tests).
 */
import { toCss, type Rgb } from './oklch'
import { kindRoles, type GeneratedTheme, type KindFamilyId } from './themeGenerator'

/** Accent scale index of the primary hover: one step away from the dark on-accent text. */
export const ACCENT_HOVER_STEP = { dark: 9, light: 7 } as const

/** An opaque colour drawn at an alpha. */
export type Ink = readonly [color: Rgb, alpha: number]

const ink = ([color, alpha]: Ink): string => toCss(color, alpha)
const mix = (color: Rgb, percent: number): string => toCss(color, percent / 100)
const black = (alpha: number): string => `rgb(0 0 0 / ${alpha})`

/** The destructive-confirmation dialog; the contrast matrix composites these inks over its sheet. */
export function dangerDialog(theme: GeneratedTheme) {
  const dark = theme.input.appearance === 'dark'
  const r = theme.red
  const n = theme.neutral
  const strong = dark ? r[11]! : n[11]!
  const supporting = dark ? r[11]! : n[10]!
  return {
    sheetTop: dark ? r[1]! : n[0]!,
    sheetBottom: dark ? r[0]! : r[1]!,
    glow: [dark ? r[6]! : r[8]!, dark ? 0.22 : 0.16] as Ink,
    status: [dark ? r[3]! : r[8]!, dark ? 0.66 : 0.12] as Ink,
    statusText: [dark ? r[11]! : r[10]!, dark ? 0.94 : 1] as Ink,
    text: {
      title: [strong, dark ? 0.98 : 0.92],
      lead: [strong, dark ? 0.98 : 0.92],
      'option-strong': [strong, dark ? 0.98 : 0.92],
      supporting: [supporting, dark ? 0.84 : 1],
      'option-text': [supporting, dark ? 0.8 : 0.94],
      summary: [r[10]!, dark ? 0.76 : 0.86],
      path: [dark ? r[11]! : r[10]!, dark ? 0.95 : 0.92],
    } satisfies Record<string, Ink>,
  }
}

function dialogTokens(theme: GeneratedTheme): Record<string, string> {
  const dark = theme.input.appearance === 'dark'
  const r = theme.red
  const n = theme.neutral
  const d = dangerDialog(theme)
  const sheet = (top: Rgb, bottom: Rgb, glow: Ink, reach: number) =>
    `radial-gradient(circle at top right, ${ink(glow)}, transparent ${reach}%), ` +
    `linear-gradient(180deg, ${toCss(top, 0.96)}, ${toCss(bottom, 0.96)})`
  const lift = dark ? black(0.58) : toCss(n[11]!, 0.18)
  return {
    '--cove-overlay-danger-backdrop': dark ? toCss(r[0]!, 0.72) : toCss(r[11]!, 0.24),
    '--cove-overlay-danger-border': dark ? toCss(r[7]!, 0.42) : toCss(r[8]!, 0.22),
    '--cove-overlay-danger-divider': dark ? toCss(r[7]!, 0.24) : toCss(r[8]!, 0.18),
    '--cove-overlay-danger-surface': sheet(d.sheetTop, d.sheetBottom, d.glow, dark ? 42 : 56),
    '--cove-overlay-danger-shadow': `0 24px 56px ${lift}, 0 0 0 1px ${toCss(dark ? r[6]! : r[8]!, dark ? 0.18 : 0.08)}`,
    '--cove-overlay-danger-status-border': toCss(r[8]!, dark ? 0.36 : 0.32),
    '--cove-overlay-danger-status-surface': ink(d.status),
    '--cove-overlay-danger-status-text': ink(d.statusText),
    ...Object.fromEntries(
      Object.entries(d.text).map(([id, value]) => [`--cove-overlay-danger-${id}`, ink(value)]),
    ),
    '--cove-overlay-warning-backdrop': dark ? toCss(n[0]!, 0.64) : toCss(n[11]!, 0.34),
    '--cove-overlay-warning-border': toCss(r[8]!, dark ? 0.34 : 0.2),
    '--cove-overlay-warning-surface': dark
      ? sheet(n[1]!, n[0]!, [r[8]!, 0.18], 52)
      : sheet(n[0]!, n[1]!, [r[8]!, 0.16], 58),
    '--cove-overlay-warning-shadow': `0 24px 56px ${dark ? black(0.55) : lift}, 0 0 0 1px ${toCss(r[8]!, dark ? 0.12 : 0.06)}`,
    '--cove-overlay-warning-pill-border': toCss(r[8]!, dark ? 0.38 : 0.28),
    '--cove-overlay-warning-pill-surface': toCss(r[8]!, dark ? 0.12 : 0.1),
  }
}

/** Space regions keep the standard structure (dashed edge, tinted fill) in the accent hue. */
function spaceRegionTokens(theme: GeneratedTheme): Record<string, string> {
  const dark = theme.input.appearance === 'dark'
  const a = theme.accent
  const edge = dark ? a[9]! : a[8]!
  const strong = dark ? a[10]! : a[8]!
  const fill = a[8]!
  return {
    '--cove-space-region-border': mix(edge, dark ? 78 : 36),
    '--cove-space-region-surface': mix(fill, dark ? 12 : 5),
    '--cove-space-region-shadow': `inset 0 0 0 1px ${mix(edge, dark ? 10 : 8)}`,
    '--cove-space-region-border-active': mix(strong, dark ? 95 : 54),
    '--cove-space-region-surface-active': mix(fill, dark ? 18 : 7),
    '--cove-space-region-shadow-active': `inset 0 0 0 1px ${mix(strong, dark ? 28 : 18)}, 0 0 0 1px ${mix(fill, dark ? 38 : 18)}`,
    '--cove-space-region-border-selected': mix(strong, dark ? 98 : 72),
    '--cove-space-region-surface-selected': mix(fill, dark ? 22 : 9),
    '--cove-space-region-shadow-selected': `inset 0 0 0 1px ${mix(strong, dark ? 34 : 22)}, 0 0 0 1px ${mix(fill, dark ? 44 : 24)}, 0 0 ${dark ? 22 : 18}px ${mix(fill, dark ? 38 : 16)}`,
  }
}

export function hostTokens(theme: GeneratedTheme): Record<string, string> {
  const dark = theme.input.appearance === 'dark'
  const n = theme.neutral
  const a = theme.accent
  const ink12 = n[11]!
  const kind = (id: KindFamilyId) => kindRoles(theme, id).solid
  const shade = (darkAlpha: number, lightAlpha: number) =>
    dark ? black(darkAlpha) : toCss(ink12, lightAlpha)
  return {
    '--cove-backdrop': dark ? toCss(n[0]!, 0.6) : toCss(ink12, 0.24),
    '--cove-shadow-color-elevated': shade(0.42, 0.14),
    '--cove-shadow-color-panel': shade(0.58, 0.18),
    '--cove-node-shadow-color': shade(0.45, 0.14),
    '--cove-node-selection-border': dark ? mix(a[9]!, 88) : mix(a[8]!, 72),
    '--cove-node-selection-shadow': `0 0 0 1px ${dark ? mix(a[9]!, 42) : mix(a[8]!, 18)}, 0 18px 40px ${shade(0.52, 0.18)}`,
    // Terminal windows share the window glass; the reading plate is --cove-terminal-background.
    '--cove-terminal-node-surface': 'var(--cove-node-surface)',
    '--cove-terminal-node-header-surface': 'var(--cove-node-header-surface)',
    '--cove-toggle-track-on': 'var(--cove-accent)',
    '--cove-toggle-track-off': 'var(--cove-neutral-8)',
    '--cove-toggle-thumb': dark ? 'var(--cove-neutral-12)' : 'var(--cove-neutral-1)',
    // On-accent text is dark in both appearances, so hover lightens to keep 4.5:1.
    '--cove-settings-primary-background': 'var(--cove-accent)',
    '--cove-settings-primary-background-hover': `var(--cove-accent-${ACCENT_HOVER_STEP[theme.input.appearance] + 1})`,
    '--cove-settings-on-accent': 'var(--cove-accent-foreground)',
    '--cove-canvas-control-surface': dark ? mix(n[1]!, 72) : mix(n[0]!, 74),
    '--cove-canvas-control-surface-hover': dark ? mix(n[3]!, 90) : mix(n[0]!, 94),
    '--cove-canvas-control-border': 'var(--cove-neutral-7)',
    '--cove-canvas-control-border-hover': mix(a[8]!, dark ? 80 : 65),
    '--cove-canvas-control-text': 'var(--cove-text-muted)',
    '--cove-canvas-control-text-hover': 'var(--cove-text)',
    '--cove-canvas-minimap-surface': dark ? mix(n[1]!, 75) : mix(n[0]!, 72),
    '--cove-canvas-minimap-border': 'var(--cove-neutral-6)',
    '--cove-canvas-minimap-mask': dark ? mix(a[9]!, 84) : mix(a[8]!, 80),
    '--cove-canvas-minimap-mask-surface': mix(a[8]!, dark ? 14 : 10),
    // Window marks use the CVD-validated kind families: agents AI, tasks plan, images media.
    '--cove-canvas-minimap-node-agent': mix(kind('ai'), dark ? 78 : 72),
    '--cove-canvas-minimap-node-task': mix(kind('plan'), dark ? 78 : 66),
    '--cove-canvas-minimap-node-image': mix(kind('media'), dark ? 78 : 66),
    '--cove-canvas-minimap-node-default': mix(kind('knowledge'), dark ? 70 : 55),
    '--cove-canvas-minimap-node-stroke': shade(0.18, 0.14),
    ...spaceRegionTokens(theme),
    ...dialogTokens(theme),
  }
}
