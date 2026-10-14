/**
 * Colour maths for the generated design system.
 * sRGB values are 0–255 tuples; OKLCH lightness is 0–1, chroma is absolute, hue in degrees.
 */
export type Rgb = readonly [number, number, number]
export type CvdKind = 'protan' | 'deutan' | 'tritan'

const toLinear = (v: number): number => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const encode = (x: number): number => {
  const c = Math.min(1, Math.max(0, x))
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const lchToLinear = (L: number, C: number, H: number): [number, number, number] => {
  const h = (H * Math.PI) / 180
  return oklabToLinear(L, C * Math.cos(h), C * Math.sin(h))
}

const inGamut = (v: readonly number[]): boolean => v.every(x => x >= -0.0001 && x <= 1.0001)

/** OKLCH to sRGB. Out-of-gamut colours keep lightness and hue and lose chroma (binary search). */
export function oklch(L: number, C: number, H: number): Rgb {
  let linear = lchToLinear(L, C, H)
  if (!inGamut(linear)) {
    let lo = 0
    let hi = C
    for (let i = 0; i < 22; i += 1) {
      const mid = (lo + hi) / 2
      if (inGamut(lchToLinear(L, mid, H))) {
        lo = mid
      } else {
        hi = mid
      }
    }
    linear = lchToLinear(L, lo, H)
  }
  return [
    Math.round(encode(linear[0]) * 255),
    Math.round(encode(linear[1]) * 255),
    Math.round(encode(linear[2]) * 255),
  ]
}

export function rgbToOklab(c: Rgb): [number, number, number] {
  return linearToOklab(toLinear(c[0]), toLinear(c[1]), toLinear(c[2]))
}

export function relativeLuminance(c: Rgb): number {
  return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2])
}

/** WCAG 2 contrast ratio. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const x = relativeLuminance(a)
  const y = relativeLuminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Source-over compositing of an opaque colour at `alpha` onto an opaque backdrop, in sRGB like the browser. */
export function mixOver(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return [
    Math.round(top[0] * alpha + bottom[0] * (1 - alpha)),
    Math.round(top[1] * alpha + bottom[1] * (1 - alpha)),
    Math.round(top[2] * alpha + bottom[2] * (1 - alpha)),
  ]
}

export function shift(c: Rgb, delta: number): Rgb {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v + delta)))
  return [clamp(c[0]), clamp(c[1]), clamp(c[2])]
}

export function toCss(c: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c[0]} ${c[1]} ${c[2]})` : `rgb(${c[0]} ${c[1]} ${c[2]} / ${alpha})`
}

// Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB.
const CVD_MATRICES: Record<CvdKind, readonly number[]> = {
  protan: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
  ],
  deutan: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
  ],
  tritan: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039,
  ],
}

export function simulateCvd(c: Rgb, kind: CvdKind): Rgb {
  const m = CVD_MATRICES[kind]
  const r = toLinear(c[0])
  const g = toLinear(c[1])
  const b = toLinear(c[2])
  const out = [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ]
  return [
    Math.round(encode(out[0]) * 255),
    Math.round(encode(out[1]) * 255),
    Math.round(encode(out[2]) * 255),
  ]
}

/** Perceptual distance: Euclidean OKLab distance × 100. */
export function deltaE(a: Rgb, b: Rgb): number {
  const x = rgbToOklab(a)
  const y = rgbToOklab(b)
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100
}
