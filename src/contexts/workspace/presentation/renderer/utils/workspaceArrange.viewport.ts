import type { Size } from '../types'

export function resolveViewportAspectRatio(viewport?: Partial<Size>): number {
  const width =
    typeof viewport?.width === 'number' && Number.isFinite(viewport.width) && viewport.width > 0
      ? viewport.width
      : typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
        ? window.innerWidth
        : 1440
  const height =
    typeof viewport?.height === 'number' && Number.isFinite(viewport.height) && viewport.height > 0
      ? viewport.height
      : typeof window !== 'undefined' &&
          Number.isFinite(window.innerHeight) &&
          window.innerHeight > 0
        ? window.innerHeight
        : 900

  if (height <= 0) {
    return 16 / 9
  }

  const ratio = width / height
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 16 / 9
  }

  return ratio
}
