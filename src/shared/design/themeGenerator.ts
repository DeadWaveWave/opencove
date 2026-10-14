/**
 * Theme generator: four inputs (appearance, base hue and chroma, accent, contrast) produce every
 * colour the UI uses, so contrast guarantees are asserted in unit tests instead of checked by eye.
 */
import { contrastRatio, oklch, type Rgb } from './oklch'

export type Appearance = 'dark' | 'light'

export interface ThemeInput {
  appearance: Appearance
  baseHue: number
  baseChroma: number
  accentHue: number
  accentChroma: number
  /** 0 = default spacing between steps, 1 = maximum contrast. */
  contrast: number
}

export type FamilyInput = Omit<ThemeInput, 'appearance' | 'contrast'>

/** Built-in families in picker order. */
export const THEME_FAMILY_LIST = [
  { id: 'cove', baseHue: 248, baseChroma: 0.018, accentHue: 220, accentChroma: 0.13 },
  { id: 'ember', baseHue: 50, baseChroma: 0.022, accentHue: 42, accentChroma: 0.14 },
  { id: 'graphite', baseHue: 265, baseChroma: 0.005, accentHue: 255, accentChroma: 0.06 },
] as const

export type ThemeFamilyId = (typeof THEME_FAMILY_LIST)[number]['id']

export const THEME_FAMILIES = Object.fromEntries(
  THEME_FAMILY_LIST.map(({ id, ...input }) => [id, input]),
) as Record<ThemeFamilyId, FamilyInput>

export const DEFAULT_CONTRAST = 0.35

export type KindFamilyId = 'ai' | 'shell' | 'plan' | 'knowledge' | 'media'

/** Five kind families, validated all-pairs for colour-vision deficiency. Folder and plugin windows are neutral. */
export const KIND_FAMILIES: Record<
  KindFamilyId,
  { hue: number; chroma: Record<Appearance, number>; anchor: Record<Appearance, number> }
> = {
  ai: { hue: 296, chroma: { dark: 0.16, light: 0.16 }, anchor: { dark: 0.525, light: 0.45 } },
  shell: { hue: 160, chroma: { dark: 0.15, light: 0.16 }, anchor: { dark: 0.66, light: 0.58 } },
  plan: { hue: 60, chroma: { dark: 0.15, light: 0.145 }, anchor: { dark: 0.56, light: 0.6 } },
  knowledge: {
    hue: 250,
    chroma: { dark: 0.16, light: 0.165 },
    anchor: { dark: 0.645, light: 0.58 },
  },
  media: { hue: 348, chroma: { dark: 0.15, light: 0.165 }, anchor: { dark: 0.6, light: 0.5 } },
}

export const LABEL_HUES = {
  red: { hue: 25, chroma: 0.19 },
  orange: { hue: 55, chroma: 0.17 },
  yellow: { hue: 95, chroma: 0.16 },
  green: { hue: 150, chroma: 0.17 },
  blue: { hue: 255, chroma: 0.17 },
  purple: { hue: 305, chroma: 0.18 },
} as const
export type LabelId = keyof typeof LABEL_HUES
/** Label rings are 1.5px graphics on the canvas: light mode anchors them darker to keep 3:1. */
const LABEL_ANCHOR: Record<Appearance, number | undefined> = { dark: undefined, light: 0.56 }

const L_DARK = [0.155, 0.178, 0.212, 0.24, 0.268, 0.305, 0.365, 0.45, 0.7, 0.745, 0.82, 0.95]
// Step 11 (secondary text) is 0.47 so text on light glass keeps 4.5:1 even at the lowest contrast setting.
const L_LIGHT = [0.993, 0.978, 0.955, 0.932, 0.906, 0.876, 0.83, 0.765, 0.66, 0.62, 0.47, 0.255]
const CHROMA = [0.1, 0.16, 0.3, 0.4, 0.5, 0.6, 0.7, 0.84, 1, 0.96, 0.86, 0.42]
const NEUTRAL_CHROMA = [0.7, 0.75, 0.85, 0.9, 1, 1, 1, 1, 0.9, 0.85, 0.6, 0.35]

/** Glass alphas per appearance. The CSS and the worst-case contrast check read the same numbers. */
export const GLASS = {
  dark: { frame: 0.52, plate: 0.55, farTint: 0.2, chrome: 0.6, sheet: 0.72 },
  light: { frame: 0.64, plate: 0.7, farTint: 0.22, chrome: 0.66, sheet: 0.8 },
} as const

/** Pixel wall mixing weights. `cap` bounds how far a cell behind glass may move toward any colour (I6). */
export const PIXEL_WALL = {
  dark: {
    cell: 0.205,
    gap: 0.135,
    cloudL: 0.34,
    cloudC: 0.075,
    sparkL: 0.64,
    sparkC: 0.15,
    cloudA: 0.55,
    workA: 0.62,
    cap: 0.6,
    tileJitter: 5,
    falloff: 0,
  },
  light: {
    cell: 0.915,
    gap: 0.985,
    cloudL: 0.84,
    cloudC: 0.07,
    sparkL: 0.64,
    sparkC: 0.19,
    cloudA: 0.8,
    workA: 0.72,
    cap: 0.5,
    tileJitter: 9,
    falloff: 14,
  },
} as const
const CLOUD_HUES = [348, 296, 250, 200] as const

export type Scale = readonly Rgb[]

function lightness(ap: Appearance, k: number): number[] {
  const L = (ap === 'dark' ? L_DARK : L_LIGHT).slice()
  if (ap === 'dark') {
    L[5]! += 0.025 * k
    L[6]! += 0.035 * k
    L[7]! += 0.05 * k
    L[10] = Math.min(0.9, L[10]! + 0.06 * k)
    L[11] = Math.min(0.985, L[11]! + 0.035 * k)
  } else {
    L[5]! -= 0.025 * k
    L[6]! -= 0.035 * k
    L[7]! -= 0.05 * k
    L[10] = Math.max(0.36, L[10]! - 0.08 * k)
    L[11] = Math.max(0.16, L[11]! - 0.07 * k)
  }
  return L
}

function scale(
  hue: number,
  chroma: number,
  ap: Appearance,
  k: number,
  opts: { anchor?: number; neutral?: boolean } = {},
): Scale {
  const L = lightness(ap, k)
  if (opts.anchor !== undefined) {
    L[8] = opts.anchor
  }
  return L.map((l, i) => oklch(l, chroma * (opts.neutral ? NEUTRAL_CHROMA[i]! : CHROMA[i]!), hue))
}

export const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const
export type AnsiKey = (typeof ANSI_KEYS)[number]
/** ANSI slots that are background colours by convention and are exempt from the text contrast rule. */
export const ANSI_BACKGROUND_SLOTS: Record<Appearance, readonly AnsiKey[]> = {
  dark: ['black'],
  light: ['white', 'brightWhite'],
}

// [hue, chroma] for the six chromatic ANSI slots; lightness comes from the appearance.
const ANSI_HUES: Record<
  'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan',
  readonly [number, number]
> = {
  red: [25, 0.16],
  green: [150, 0.15],
  yellow: [88, 0.13],
  blue: [255, 0.14],
  magenta: [322, 0.15],
  cyan: [205, 0.11],
}

export interface GeneratedTheme {
  input: ThemeInput
  neutral: Scale
  accent: Scale
  kinds: Record<KindFamilyId, Scale>
  labels: Record<LabelId, Scale>
  amber: Scale
  red: Scale
  /** Roles every surface uses. */
  roles: { canvas: Rgb; surface: Rgb; text: Rgb; textSecondary: Rgb; onAccent: Rgb }
  pixel: { cell: Rgb; gap: Rgb; clouds: readonly Rgb[]; sparks: readonly Rgb[] }
  ansi: Record<AnsiKey, Rgb>
  onSolid(solid: Rgb): Rgb
}

export function kindRoles(theme: GeneratedTheme, id: KindFamilyId | 'neutral') {
  const dark = theme.input.appearance === 'dark'
  const s = id === 'neutral' ? theme.neutral : theme.kinds[id]
  if (id === 'neutral') {
    return {
      tile: s[3]!,
      line: s[6]!,
      glyph: s[10]!,
      solid: dark ? s[7]! : s[8]!,
      on: dark ? s[11]! : s[0]!,
      far: s[dark ? 10 : 11]!,
    }
  }
  return {
    tile: dark ? s[3]! : s[2]!,
    line: s[6]!,
    glyph: s[10]!,
    solid: s[8]!,
    on: theme.onSolid(s[8]!),
    far: s[dark ? 10 : 11]!,
  }
}

export function generateTheme(input: ThemeInput): GeneratedTheme {
  const ap = input.appearance
  const dark = ap === 'dark'
  const k = Math.min(1, Math.max(0, input.contrast))
  const neutral = scale(input.baseHue, input.baseChroma, ap, k, { neutral: true })
  const accent = scale(input.accentHue, input.accentChroma, ap, k)
  const kinds = Object.fromEntries(
    (Object.keys(KIND_FAMILIES) as KindFamilyId[]).map(id => {
      const f = KIND_FAMILIES[id]
      return [id, scale(f.hue, f.chroma[ap], ap, k, { anchor: f.anchor[ap] })]
    }),
  ) as Record<KindFamilyId, Scale>
  const labels = Object.fromEntries(
    (Object.keys(LABEL_HUES) as LabelId[]).map(id => [
      id,
      scale(LABEL_HUES[id].hue, LABEL_HUES[id].chroma, ap, k, { anchor: LABEL_ANCHOR[ap] }),
    ]),
  ) as Record<LabelId, Scale>
  const amber = scale(92, 0.17, ap, k, { anchor: dark ? 0.84 : 0.62 })
  const red = scale(25, 0.19, ap, k, { anchor: dark ? 0.66 : 0.56 })
  const white: Rgb = [255, 255, 255]
  const inkDark = dark ? neutral[0]! : neutral[11]!
  const onSolid = (solid: Rgb): Rgb =>
    contrastRatio(inkDark, solid) >= contrastRatio(white, solid) ? inkDark : white
  const P = PIXEL_WALL[ap]
  const pixel = {
    cell: oklch(P.cell, input.baseChroma * 0.9, input.baseHue),
    gap: oklch(P.gap, input.baseChroma * 0.6, input.baseHue),
    clouds: CLOUD_HUES.map(h => oklch(P.cloudL, P.cloudC, h)),
    sparks: CLOUD_HUES.map(h => oklch(P.sparkL, P.sparkC, h)),
  }
  // ANSI: chromatic slots at fixed hues; lightness moves away from the plate as `contrast` rises.
  const ansi = {} as Record<AnsiKey, Rgb>
  const normalL = dark ? 0.74 + 0.04 * k : 0.5 - 0.05 * k
  const brightL = dark ? 0.83 + 0.03 * k : 0.44 - 0.05 * k
  for (const [slot, [hue, chroma]] of Object.entries(ANSI_HUES)) {
    const bright = `bright${slot[0]!.toUpperCase()}${slot.slice(1)}` as AnsiKey
    ansi[slot as AnsiKey] = oklch(normalL, chroma, hue)
    ansi[bright] = oklch(brightL, chroma * (dark ? 0.85 : 1.1), hue)
  }
  ansi.black = dark ? neutral[3]! : neutral[11]!
  ansi.brightBlack = dark ? neutral[8]! : neutral[10]!
  ansi.white = dark ? neutral[10]! : neutral[6]!
  ansi.brightWhite = dark ? neutral[11]! : neutral[2]!
  return {
    input,
    neutral,
    accent,
    kinds,
    labels,
    amber,
    red,
    roles: {
      canvas: dark ? neutral[0]! : neutral[2]!,
      surface: dark ? neutral[1]! : neutral[0]!,
      text: neutral[11]!,
      textSecondary: neutral[10]!,
      onAccent: onSolid(accent[8]!),
    },
    pixel,
    ansi,
    onSolid,
  }
}

export function generateFamilyTheme(
  family: ThemeFamilyId,
  appearance: Appearance,
  contrast = DEFAULT_CONTRAST,
): GeneratedTheme {
  return generateTheme({ ...THEME_FAMILIES[family], appearance, contrast })
}
