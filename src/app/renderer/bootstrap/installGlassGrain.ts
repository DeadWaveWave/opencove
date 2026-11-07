import { GLASS, type Appearance } from '@shared/design/themeGenerator'

/** The Tide prototype's grain: a 180px tile of uniform random grey at one alpha. */
export const GLASS_GRAIN_SIZE = 180

// A fixed seed draws the same grain on every launch, so screenshots stay comparable.
const GRAIN_SEED = 0x7a1de

/** Mulberry32: small, fast and good enough for visual noise. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function glassGrainAlpha(appearance: Appearance): number {
  return Math.round(GLASS[appearance].grain * 255)
}

/** RGBA pixels of one grain tile: each pixel one grey from black to white, all at `alpha`. */
export function glassGrainPixels(alpha: number): Uint8ClampedArray {
  const next = seededRandom(GRAIN_SEED)
  const pixels = new Uint8ClampedArray(GLASS_GRAIN_SIZE * GLASS_GRAIN_SIZE * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    const grey = Math.floor(next() * 256)
    pixels[i] = grey
    pixels[i + 1] = grey
    pixels[i + 2] = grey
    pixels[i + 3] = alpha
  }
  return pixels
}

function grainUrl(alpha: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = GLASS_GRAIN_SIZE
  canvas.height = GLASS_GRAIN_SIZE
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  const image = context.createImageData(GLASS_GRAIN_SIZE, GLASS_GRAIN_SIZE)
  image.data.set(glassGrainPixels(alpha))
  context.putImageData(image, 0, 0)
  // A blob URL keeps the custom property short; the PNG data URL would be about 40 KB of text.
  const dataUrl = canvas.toDataURL('image/png')
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
}

/**
 * Draws the glass grain once per appearance and publishes it on the root as
 * `--cove-glass-grain-{dark,light}`, which the generated themes read through `--cove-glass-grain`.
 * Without a 2D canvas nothing is set and glass falls back to no grain.
 */
export function installGlassGrain(root: HTMLElement = document.documentElement): void {
  for (const appearance of ['dark', 'light'] as const) {
    const url = grainUrl(glassGrainAlpha(appearance))
    if (url) {
      root.style.setProperty(`--cove-glass-grain-${appearance}`, `url("${url}")`)
    }
  }
}
