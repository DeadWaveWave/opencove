/**
 * Maps a generated theme to CSS custom properties: the new scales, kind, status, glass and pixel
 * tokens, every v1 public token so installed plugin themes keep resolving, and the host tokens
 * that replace the standard theme's literal colours.
 */
import type { Rgb } from './oklch'
import { hostTokens } from './themeHostTokens'
import { statusPillTokens } from './themeStatusTokens'
import {
  ANSI_KEYS,
  GLASS,
  KIND_FAMILIES,
  LABEL_HUES,
  generateFamilyTheme,
  generateTheme,
  kindRoles,
  type AnsiKey,
  type Appearance,
  type GeneratedTheme,
  type KindFamilyId,
  type ThemeFamilyId,
  type ThemeInput,
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
    // Terminals read on their kind's plate: this is the shell's, and an agent window picks the
    // AI plate (terminal-node.css).
    terminalBackground: theme.kindPlates.shell,
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
    '--cove-glass-chrome': percent(glass.chrome),
    '--cove-glass-sheet': percent(glass.sheet),
    '--cove-glass-acrylic': percent(glass.acrylic),
    '--cove-glass-far-tint': percent(glass.farTint),
    '--cove-glass-sheen': `rgb(255 255 255 / ${glass.sheen})`,
    '--cove-glass-rim-hi': `rgb(255 255 255 / ${glass.rimHi})`,
    '--cove-glass-rim-lo': `rgb(255 255 255 / ${glass.rimLo})`,
    // Drawn once at startup (bootstrap/installGlassGrain.ts); glass has no grain until then.
    '--cove-glass-grain': `var(--cove-glass-grain-${ap}, none)`,
    '--cove-pixel-spot': hex(theme.pixel.spot),
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
    '--cove-acrylic-grain': 'var(--cove-glass-grain)',
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
    // Window content sits on a solid plate, so the wall never shows through what is being read.
    // This is the theme's own; each window picks its kind's (`--cove-kind-*-plate`). It has no
    // edge of its own: it melts into the glass frame on every side (window-plate.css).
    '--cove-reading-plate': hex(theme.roles.plate),
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
    // Lit glass (Tide prototype): a sheen fading down from the top edge over the grain, and a
    // specular rim lit from the top left. Reduced transparency zeroes all three.
    '--cove-node-background-image':
      'linear-gradient(180deg, var(--cove-glass-sheen), transparent 30%), var(--cove-glass-grain)',
    '--cove-node-rim':
      'linear-gradient(162deg, var(--cove-glass-rim-hi), var(--cove-glass-rim-lo) 30%, transparent 54%, var(--cove-glass-rim-lo))',
    '--cove-chrome-background-image':
      'linear-gradient(180deg, var(--cove-glass-sheen), transparent 60%), var(--cove-glass-grain)',
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
  // The plates a terminal window picks its colour from (terminal-node.css).
  '--cove-kind-shell-plate',
  '--cove-kind-ai-plate',
  '--cove-kind-neutral-plate',
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
  // The frame follows the shell's glass; the terminal colour is the window kind's plate, picked
  // on the window from the dark plates below (terminal-node.css), and the shell's where none is.
  const follows: Partial<Record<(typeof TERMINAL_SCOPE_TOKENS)[number], string>> = {
    '--cove-terminal-node-surface': 'var(--cove-node-surface)',
    '--cove-terminal-background': `var(--cove-terminal-kind-plate, ${resolve(tokens['--cove-kind-shell-plate']!)})`,
  }
  return Object.fromEntries(
    TERMINAL_SCOPE_TOKENS.map(name => [name, follows[name] ?? resolve(tokens[name]!)]),
  )
}

const GENERATED_HEADER =
  '/* Generated by `pnpm design:tokens` from src/shared/design. Do not edit by hand. */'

const rule = (selector: string, tokens: ThemeTokens): string =>
  `${selector} {\n${Object.entries(tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')}\n}\n`

const DARK_TERMINAL = ".terminal-node[data-cove-terminal-node-theme='dark']"

/**
 * The blocks one generated theme needs under `root`: a block per appearance, the dark palette for
 * dark terminal windows, and, under a light shell, an opaque dark frame that keeps their light
 * title readable.
 */
function themeBlocks(
  root: string,
  appearances: readonly Appearance[],
  generate: (appearance: Appearance) => GeneratedTheme,
): string[] {
  const blocks = appearances.map(appearance =>
    rule(`${root}[data-cove-theme='${appearance}']`, themeTokens(generate(appearance))),
  )
  const dark = generate('dark')
  blocks.push(rule(`${root} ${DARK_TERMINAL}`, terminalScopeTokens(dark)))
  if (appearances.includes('light')) {
    blocks.push(
      rule(`${root}[data-cove-theme='light'] ${DARK_TERMINAL}`, {
        '--cove-terminal-node-surface': rgba(dark.neutral[1]!, 0.94),
      }),
    )
  }
  return blocks
}

/**
 * One stylesheet per family. Scoped to `data-cove-family`, which the theme owner sets while one
 * of the family's themes (or a plugin theme built on it) is applied.
 */
export function renderFamilyStylesheet(family: ThemeFamilyId): string {
  const blocks = themeBlocks(`:root[data-cove-family='${family}']`, ['dark', 'light'], appearance =>
    generateFamilyTheme(family, appearance),
  )
  return `${GENERATED_HEADER}\n${blocks.join('\n')}`
}

/**
 * A plugin theme's palette (theme API v2), generated at runtime by the same pipeline. `scope`
 * narrows the Cove family selector to the theme's identity, so every block outranks the family
 * block it replaces and applies only while that theme is selected.
 */
export function renderPaletteStylesheet(scope: string, input: ThemeInput): string {
  return themeBlocks(scope, [input.appearance], appearance =>
    generateTheme({ ...input, appearance }),
  ).join('\n')
}
