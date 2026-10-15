/**
 * Maps a generated theme to CSS custom properties: the new scales, kind, status, glass and pixel
 * tokens, every v1 public token so installed plugin themes keep resolving, and the host tokens
 * that replace the standard theme's literal colours.
 */
import { mixOver, type Rgb } from './oklch'
import { hostTokens } from './themeHostTokens'
import { statusPillTokens } from './themeStatusTokens'
import {
  ANSI_KEYS,
  GLASS,
  KIND_FAMILIES,
  LABEL_HUES,
  generateFamilyTheme,
  kindRoles,
  type AnsiKey,
  type Appearance,
  type GeneratedTheme,
  type KindFamilyId,
  type ThemeFamilyId,
} from './themeGenerator'

export type ThemeTokens = Readonly<Record<string, string>>

/** Accent step of the cyan effect fragments; light mode goes one darker to keep 3:1 on surfaces. */
export const PIXEL_CYAN_STEP = { dark: 8, light: 9 } as const

const hex = (c: Rgb): string => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`
const rgba = (c: Rgb, alpha: number): string => `rgb(${c[0]} ${c[1]} ${c[2]} / ${alpha})`
const percent = (alpha: number): string => `${Math.round(alpha * 100)}%`
const kebab = (key: AnsiKey): string => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

/** Opaque role colours. Tokens and the contrast tests both read these, so they cannot drift apart. */
export interface RoleColors {
  canvas: Rgb
  elevated: Rgb
  /** Window frame, chrome and sheets tint toward this colour. */
  frame: Rgb
  text: Rgb
  textMuted: Rgb
  textFaint: Rgb
  accent: Rgb
  accentText: Rgb
  onAccent: Rgb
  focusRing: Rgb
  terminalBackground: Rgb
  terminalForeground: Rgb
  terminalCursor: Rgb
}

export function resolveRoleColors(theme: GeneratedTheme): RoleColors {
  const dark = theme.input.appearance === 'dark'
  const n = theme.neutral
  const a = theme.accent
  const frame = dark ? n[1]! : n[0]!
  // Terminals read their plate over the frame over the canvas; this is that composite, opaque.
  const plate = mixOver(
    n[0]!,
    GLASS[theme.input.appearance].plate,
    mixOver(frame, GLASS[theme.input.appearance].frame, theme.roles.canvas),
  )
  return {
    canvas: theme.roles.canvas,
    elevated: theme.roles.surface,
    frame,
    text: n[11]!,
    textMuted: n[10]!,
    // Tertiary metadata only; placeholders and body copy use muted text or stronger.
    textFaint: n[9]!,
    accent: a[8]!,
    accentText: a[10]!,
    onAccent: theme.roles.onAccent,
    focusRing: dark ? a[8]! : a[10]!,
    terminalBackground: plate,
    terminalForeground: n[11]!,
    terminalCursor: dark ? a[8]! : a[10]!,
  }
}

function scaleTokens(name: string, scale: readonly Rgb[]): Record<string, string> {
  return Object.fromEntries(
    scale.map((color, index) => [`--cove-${name}-${index + 1}`, hex(color)]),
  )
}

function kindTokens(theme: GeneratedTheme): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const id of [...(Object.keys(KIND_FAMILIES) as KindFamilyId[]), 'neutral' as const]) {
    for (const [role, color] of Object.entries(kindRoles(theme, id))) {
      tokens[`--cove-kind-${id}-${role}`] = hex(color)
    }
  }
  return tokens
}

export function themeTokens(theme: GeneratedTheme): ThemeTokens {
  const ap: Appearance = theme.input.appearance
  const dark = ap === 'dark'
  const roles = resolveRoleColors(theme)
  const glass = GLASS[ap]
  const frameStep = dark ? 'var(--cove-neutral-2)' : 'var(--cove-neutral-1)'
  const ink = theme.neutral[11]!
  const shadow = dark ? rgba([0, 0, 0], 0.4) : rgba(ink, 0.14)
  const shadowHover = dark ? rgba([0, 0, 0], 0.46) : rgba(ink, 0.18)
  const glassOf = (alpha: string) => `color-mix(in srgb, ${frameStep} ${alpha}, transparent)`
  // Constant mixes are emitted as computed colours; only runtime-tunable glass stays color-mix().
  const inkOverlay = (amount: number) => rgba(ink, amount / 100)

  const ansi = Object.fromEntries(
    ANSI_KEYS.map(key => [`--cove-terminal-ansi-${kebab(key)}`, hex(theme.ansi[key])]),
  )
  const labels = Object.fromEntries(
    (Object.keys(LABEL_HUES) as Array<keyof typeof LABEL_HUES>).map(id => [
      `--cove-label-${id}`,
      hex(theme.labels[id][8]!),
    ]),
  )

  return {
    ...scaleTokens('neutral', theme.neutral),
    ...scaleTokens('accent', theme.accent),
    ...kindTokens(theme),
    '--cove-status-waiting': hex(theme.amber[8]!),
    '--cove-status-failed': hex(theme.red[8]!),
    ...statusPillTokens(theme),
    '--cove-label-gray': hex(theme.neutral[8]!),
    ...labels,
    '--cove-glass-frame': percent(glass.frame),
    '--cove-glass-plate': percent(glass.plate),
    '--cove-glass-chrome': percent(glass.chrome),
    '--cove-glass-sheet': percent(glass.sheet),
    '--cove-glass-acrylic': percent(glass.acrylic),
    '--cove-glass-far-tint': percent(glass.farTint),
    '--cove-pixel-cell': hex(theme.pixel.cell),
    '--cove-pixel-gap': hex(theme.pixel.gap),
    ...Object.fromEntries(
      theme.pixel.clouds.map((c, i) => [`--cove-pixel-cloud-${i + 1}`, hex(c)]),
    ),
    ...Object.fromEntries(
      theme.pixel.sparks.map((c, i) => [`--cove-pixel-spark-${i + 1}`, hex(c)]),
    ),

    // v1 public tokens (plugin theme contract).
    '--cove-app-background': hex(roles.canvas),
    '--cove-app-background-elevated': hex(roles.elevated),
    '--cove-surface': glassOf('var(--cove-glass-chrome)'),
    '--cove-surface-strong': glassOf('var(--cove-glass-sheet)'),
    '--cove-acrylic-surface': glassOf('var(--cove-glass-acrylic)'),
    '--cove-window-surface': hex(roles.frame),
    '--cove-surface-hover': inkOverlay(dark ? 7 : 5),
    '--cove-field': inkOverlay(dark ? 5 : 4),
    '--cove-border': 'var(--cove-neutral-7)',
    '--cove-border-subtle': 'var(--cove-neutral-6)',
    '--cove-text': hex(roles.text),
    '--cove-text-muted': hex(roles.textMuted),
    '--cove-text-faint': hex(roles.textFaint),
    '--cove-accent': hex(roles.accent),
    '--cove-accent-text': hex(roles.accentText),
    '--cove-accent-foreground': hex(roles.onAccent),
    '--cove-focus-ring': hex(roles.focusRing),
    '--cove-node-surface': glassOf('var(--cove-glass-frame)'),
    '--cove-node-header-surface': 'transparent',
    '--cove-node-border': inkOverlay(dark ? 14 : 16),
    '--cove-terminal-background': hex(roles.terminalBackground),
    '--cove-terminal-foreground': hex(roles.terminalForeground),
    '--cove-terminal-cursor': hex(roles.terminalCursor),
    '--cove-terminal-selection': rgba(theme.accent[8]!, dark ? 0.32 : 0.24),
    '--cove-canvas-dot': dark ? 'var(--cove-neutral-6)' : 'var(--cove-neutral-7)',
    ...ansi,
    '--cove-pixel-blue': 'var(--cove-kind-knowledge-solid)',
    '--cove-pixel-cyan': `var(--cove-accent-${PIXEL_CYAN_STEP[ap] + 1})`,
    '--cove-pixel-mint': 'var(--cove-kind-shell-solid)',
    '--cove-node-background-image': 'none',
    '--cove-node-shadow': `0 10px 28px ${shadow}`,
    '--cove-node-shadow-hover': `0 14px 36px ${shadowHover}`,
    '--cove-node-shadow-focus': `0 0 0 1px var(--cove-focus-ring), 0 10px 28px ${shadow}`,
    '--cove-node-header-border': inkOverlay(8),
    // Glass is pre-composited over the wall; headers no longer pay for a backdrop filter.
    '--cove-pixel-header-filter': 'none',
    '--cove-space-surface': inkOverlay(2),
    '--cove-space-border': 'var(--cove-neutral-6)',
    '--cove-space-shadow': 'none',
    '--cove-space-caption-surface': 'var(--cove-surface)',

    ...hostTokens(theme),
  }
}

/** Tokens a dark terminal window re-declares (the shell may be light when terminals are forced dark). */
const TERMINAL_SCOPE_TOKENS = [
  '--cove-node-border',
  '--cove-node-header-border',
  '--cove-node-shadow-color',
  '--cove-node-selection-border',
  '--cove-node-selection-shadow',
  '--cove-terminal-node-surface',
  '--cove-terminal-node-header-surface',
  '--cove-terminal-background',
  '--cove-terminal-foreground',
  '--cove-terminal-selection',
  '--cove-terminal-cursor',
  '--cove-text',
  '--cove-text-muted',
  '--cove-text-faint',
  '--cove-border',
  '--cove-border-subtle',
  '--cove-field',
  '--cove-surface-hover',
] as const

/**
 * A dark theme's palette for dark terminal windows, resolved so it holds under a light shell.
 * The frame keeps following the shell's window glass; a light shell overrides it separately.
 */
export function terminalScopeTokens(darkTheme: GeneratedTheme): ThemeTokens {
  const tokens = themeTokens(darkTheme)
  const resolve = (value: string): string => {
    const reference = /^var\((--cove-[a-z0-9-]+)\)$/.exec(value)
    return reference ? resolve(tokens[reference[1]!]!) : value
  }
  return Object.fromEntries(
    TERMINAL_SCOPE_TOKENS.map(name => [
      name,
      name === '--cove-terminal-node-surface' ? 'var(--cove-node-surface)' : resolve(tokens[name]!),
    ]),
  )
}

const GENERATED_HEADER =
  '/* Generated by `pnpm design:tokens` from src/shared/design. Do not edit by hand. */'

const rule = (selector: string, tokens: ThemeTokens): string =>
  `${selector} {\n${Object.entries(tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')}\n}\n`

/**
 * One stylesheet per family. Scoped to `data-cove-family`, which the theme owner sets while one
 * of the family's themes (or a plugin theme built on it) is applied.
 */
export function renderFamilyStylesheet(family: ThemeFamilyId): string {
  const root = `:root[data-cove-family='${family}']`
  const terminal = ".terminal-node[data-cove-terminal-node-theme='dark']"
  const dark = generateFamilyTheme(family, 'dark')
  const blocks = (['dark', 'light'] as const).map(appearance =>
    rule(
      `${root}[data-cove-theme='${appearance}']`,
      themeTokens(generateFamilyTheme(family, appearance)),
    ),
  )
  blocks.push(rule(`${root} ${terminal}`, terminalScopeTokens(dark)))
  // A forced-dark terminal in a light shell: an opaque dark frame keeps its light title readable.
  blocks.push(
    rule(`${root}[data-cove-theme='light'] ${terminal}`, {
      '--cove-terminal-node-surface': rgba(dark.neutral[1]!, 0.94),
    }),
  )
  return `${GENERATED_HEADER}\n\n${blocks.join('\n')}`
}
