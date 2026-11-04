import { DEFAULT_CONTRAST, THEME_FAMILIES, type ThemeInput } from '@shared/design/themeGenerator'

/**
 * Theme API v2: a theme declares the generator's inputs instead of hand-written colours, and the
 * host generates every token with the pipeline that produces Cove. Appearance comes from the
 * theme itself. The limits are the ones the contrast rules are tested over.
 */
export type PluginThemePalette = Omit<ThemeInput, 'appearance'>

export const PLUGIN_THEME_PALETTE_LIMITS = {
  hue: [0, 360],
  baseChroma: [0, 0.06],
  accentChroma: [0, 0.2],
  contrast: [0, 1],
} as const

const KEYS = new Set(['base', 'accent', 'contrast'])
const COLOR_KEYS = new Set(['hue', 'chroma'])

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Plugin theme ${name} must be an object.`)
  }
  return value as Record<string, unknown>
}

function number(value: unknown, name: string, [minimum, maximum]: readonly [number, number]) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Plugin theme palette ${name} must be a number from ${minimum} to ${maximum}.`)
  }
  return value
}

function color(value: unknown, name: 'base' | 'accent', chroma: readonly [number, number]) {
  const source = record(value, `palette ${name}`)
  for (const key of Object.keys(source)) {
    if (!COLOR_KEYS.has(key)) {
      throw new Error(`Unknown plugin theme palette ${name} field: ${key}.`)
    }
  }
  return {
    hue: number(source.hue, `${name} hue`, PLUGIN_THEME_PALETTE_LIMITS.hue),
    chroma: number(source.chroma, `${name} chroma`, chroma),
  }
}

export function normalizePluginThemePalette(value: unknown): PluginThemePalette | undefined {
  if (value === undefined) {
    return undefined
  }
  const source = record(value, 'palette')
  for (const key of Object.keys(source)) {
    if (!KEYS.has(key)) {
      throw new Error(`Unknown plugin theme palette field: ${key}.`)
    }
  }
  if (source.accent === undefined) {
    throw new Error('Plugin theme palette requires an accent colour.')
  }
  const cove = THEME_FAMILIES.cove
  const base =
    source.base === undefined
      ? { hue: cove.baseHue, chroma: cove.baseChroma }
      : color(source.base, 'base', PLUGIN_THEME_PALETTE_LIMITS.baseChroma)
  const accent = color(source.accent, 'accent', PLUGIN_THEME_PALETTE_LIMITS.accentChroma)
  return {
    baseHue: base.hue,
    baseChroma: base.chroma,
    accentHue: accent.hue,
    accentChroma: accent.chroma,
    contrast:
      source.contrast === undefined
        ? DEFAULT_CONTRAST
        : number(source.contrast, 'contrast', PLUGIN_THEME_PALETTE_LIMITS.contrast),
  }
}
