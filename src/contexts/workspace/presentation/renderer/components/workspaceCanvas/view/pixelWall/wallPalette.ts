import type { Rgb } from '@shared/design/oklch'
import type { WindowKindFamily } from '../../../../utils/windowKindFamily'

export interface WallPalette {
  appearance: 'dark' | 'light'
  cell: Rgb
  gap: Rgb
  /** Four soft colours for the clouds, and the brighter twinkle of each. */
  clouds: readonly Rgb[]
  sparks: readonly Rgb[]
  /** The pointer's soft spotlight: white on dark walls, the accent in daylight. */
  spot: Rgb
}

/** Cove dark, for a theme that does not define the wall tokens. */
const FALLBACK: WallPalette = {
  appearance: 'dark',
  cell: [17, 24, 30],
  gap: [5, 9, 12],
  clouds: [
    [83, 38, 63],
    [60, 47, 90],
    [21, 58, 93],
    [0, 65, 68],
  ],
  sparks: [
    [204, 102, 160],
    [150, 118, 220],
    [70, 141, 229],
    [0, 157, 183],
  ],
  spot: [255, 255, 255],
}

export function parseWallColor(value: string): Rgb | null {
  const text = value.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const digits = hex[1]!
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map(digit => digit + digit)
            .join('')
        : digits
    const channel = (offset: number) => Number.parseInt(full.slice(offset, offset + 2), 16)
    return [channel(0), channel(2), channel(4)]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
  if (rgb) {
    const channel = (digits: string | undefined) => Math.round(Number(digits))
    return [channel(rgb[1]), channel(rgb[2]), channel(rgb[3])]
  }
  return null
}

function relativeLightness([r, g, b]: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** The wall's colours come from the theme's `--cove-pixel-*` tokens. */
export function readWallPalette(element: Element): WallPalette {
  const style = getComputedStyle(element)
  const read = (token: string, fallback: Rgb) =>
    parseWallColor(style.getPropertyValue(token)) ?? fallback
  const cell = read('--cove-pixel-cell', FALLBACK.cell)
  const appearance = relativeLightness(cell) > 0.5 ? 'light' : 'dark'
  return {
    appearance,
    spot: appearance === 'dark' ? FALLBACK.spot : read('--cove-accent', FALLBACK.spot),
    cell,
    gap: read('--cove-pixel-gap', FALLBACK.gap),
    clouds: FALLBACK.clouds.map((color, index) => read(`--cove-pixel-cloud-${index + 1}`, color)),
    sparks: FALLBACK.sparks.map((color, index) => read(`--cove-pixel-spark-${index + 1}`, color)),
  }
}

/** Work light colours: each window kind, plus waiting and failure. */
export type WallLightPalette = Record<WindowKindFamily | 'waiting' | 'failed', Rgb>

const LIGHT_FALLBACK: WallLightPalette = {
  ai: [180, 148, 239],
  shell: [140, 217, 178],
  plan: [228, 175, 116],
  knowledge: [128, 184, 239],
  media: [239, 143, 149],
  neutral: [140, 152, 168],
  waiting: [242, 197, 14],
  failed: [240, 86, 83],
}

/** Read from `--cove-wall-light-*`, which the stylesheet maps to kind and status colours. */
export function readWallLightPalette(element: Element): WallLightPalette {
  const style = getComputedStyle(element)
  return Object.fromEntries(
    (Object.keys(LIGHT_FALLBACK) as Array<keyof WallLightPalette>).map(key => [
      key,
      parseWallColor(style.getPropertyValue(`--cove-wall-light-${key}`)) ?? LIGHT_FALLBACK[key],
    ]),
  ) as WallLightPalette
}
