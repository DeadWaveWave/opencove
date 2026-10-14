/**
 * Contrast guarantees for generated themes.
 * The pixel wall is drawn by us, so every colour that can sit behind glass is enumerable;
 * text on glass is checked against all of them, not against a single nominal background.
 */
import { contrastRatio, deltaE, mixOver, shift, simulateCvd, type Rgb } from './oklch'
import {
  ANSI_BACKGROUND_SLOTS,
  ANSI_KEYS,
  GLASS,
  KIND_FAMILIES,
  PIXEL_WALL,
  kindRoles,
  type AnsiKey,
  type GeneratedTheme,
  type KindFamilyId,
} from './themeGenerator'

export interface ContrastCheck {
  id: string
  ratio: number
  min: number
}

const worst = (fg: Rgb, backgrounds: readonly Rgb[]): number =>
  Math.min(...backgrounds.map(b => contrastRatio(fg, b)))

/** Every opaque colour a cell behind glass can take: base cell (with tile jitter and daylight falloff) and capped tints. */
export function wallBackdrops(theme: GeneratedTheme): Rgb[] {
  const ap = theme.input.appearance
  const P = PIXEL_WALL[ap]
  // Renderer adds a static per-tile jitter (±tileJitter/2) and, in daylight, a falloff in [-0.55, 0.45] × falloff.
  const lowest = -(P.tileJitter / 2) - 0.55 * P.falloff
  const highest = P.tileJitter / 2 + 0.45 * P.falloff
  const bases = [
    shift(theme.pixel.cell, lowest),
    shift(theme.pixel.cell, highest),
    theme.roles.canvas,
  ]
  const targets: Array<[Rgb, number]> = [
    [theme.amber[ap === 'dark' ? 9 : 8]!, P.cap],
    [theme.red[ap === 'dark' ? 9 : 8]!, P.cap],
    ...(Object.keys(KIND_FAMILIES) as KindFamilyId[]).map(
      id => [kindRoles(theme, id).solid, P.cap] as [Rgb, number],
    ),
    ...theme.pixel.clouds.map(c => [c, Math.min(P.cap, P.cloudA)] as [Rgb, number]),
  ]
  const out: Rgb[] = []
  for (const base of bases) {
    out.push(base)
    for (const [c, a] of targets) {
      out.push(mixOver(c, a, base))
    }
  }
  return out
}

export function glassBackgrounds(theme: GeneratedTheme) {
  const ap = theme.input.appearance
  const G = GLASS[ap]
  const frameColor = ap === 'dark' ? theme.neutral[1]! : theme.neutral[0]!
  const backs = wallBackdrops(theme)
  const frames = backs.map(b => mixOver(frameColor, G.frame, b))
  return {
    frames,
    plates: frames.map(b => mixOver(theme.neutral[0]!, G.plate, b)),
    chrome: backs.map(b => mixOver(frameColor, G.chrome, b)),
    sheet: backs.map(b => mixOver(frameColor, G.sheet, b)),
  }
}

/** All contrast rules for one generated theme (I5 + I6 + terminal palette). */
export function contrastChecks(theme: GeneratedTheme): ContrastCheck[] {
  const ap = theme.input.appearance
  const n = theme.neutral
  const g = glassBackgrounds(theme)
  const checks: ContrastCheck[] = [
    { id: 'text / canvas', ratio: contrastRatio(n[11]!, theme.roles.canvas), min: 4.5 },
    { id: 'text / surface', ratio: contrastRatio(n[11]!, theme.roles.surface), min: 4.5 },
    { id: 'secondary / surface', ratio: contrastRatio(n[10]!, theme.roles.surface), min: 4.5 },
    {
      id: 'on-accent / accent',
      ratio: contrastRatio(theme.roles.onAccent, theme.accent[8]!),
      min: 4.5,
    },
    { id: 'text / glass frame (worst)', ratio: worst(n[11]!, g.frames), min: 4.5 },
    { id: 'secondary / glass frame (worst)', ratio: worst(n[10]!, g.frames), min: 4.5 },
    { id: 'terminal text / reading plate (worst)', ratio: worst(n[10]!, g.plates), min: 4.5 },
    { id: 'secondary / chrome glass (worst)', ratio: worst(n[10]!, g.chrome), min: 4.5 },
    { id: 'secondary / settings sheet (worst)', ratio: worst(n[10]!, g.sheet), min: 4.5 },
  ]
  for (const id of Object.keys(KIND_FAMILIES) as KindFamilyId[]) {
    const r = kindRoles(theme, id)
    checks.push({ id: `kind ${id} glyph / tile`, ratio: contrastRatio(r.glyph, r.tile), min: 3 })
    checks.push({ id: `kind ${id} glyph / solid`, ratio: contrastRatio(r.on, r.solid), min: 3 })
    const farBacks = g.frames.map(b => mixOver(r.solid, GLASS[ap].farTint, b))
    checks.push({ id: `kind ${id} far title (worst)`, ratio: worst(r.far, farBacks), min: 4.5 })
  }
  for (const [label, s] of Object.entries(theme.labels)) {
    checks.push({
      id: `label ${label} ring / canvas`,
      ratio: contrastRatio(s[8]!, theme.roles.canvas),
      min: 3,
    })
  }
  const exempt = new Set<AnsiKey>(ANSI_BACKGROUND_SLOTS[ap])
  for (const key of ANSI_KEYS) {
    if (exempt.has(key)) {
      continue
    }
    checks.push({
      id: `ansi ${key} / plate (worst)`,
      ratio: worst(theme.ansi[key], g.plates),
      min: 4.5,
    })
  }
  return checks
}

/** Minimum pairwise distance between the five kind solids, for normal vision and simulated CVD. */
export function kindSeparation(theme: GeneratedTheme) {
  const solids = (Object.keys(KIND_FAMILIES) as KindFamilyId[]).map(
    id => kindRoles(theme, id).solid,
  )
  const minFor = (map: (c: Rgb) => Rgb) => {
    let min = Infinity
    for (let i = 0; i < solids.length; i += 1) {
      for (let j = i + 1; j < solids.length; j += 1) {
        min = Math.min(min, deltaE(map(solids[i]!), map(solids[j]!)))
      }
    }
    return min
  }
  return {
    normal: minFor(c => c),
    protan: minFor(c => simulateCvd(c, 'protan')),
    deutan: minFor(c => simulateCvd(c, 'deutan')),
    tritan: minFor(c => simulateCvd(c, 'tritan')),
  }
}
