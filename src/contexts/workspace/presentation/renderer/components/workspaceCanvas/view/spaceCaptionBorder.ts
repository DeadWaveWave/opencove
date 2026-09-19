export interface SpaceCaptionBounds {
  left: number
  right: number
  top: number
  bottom: number
}

export interface SpaceCaptionGap {
  start: number
  end: number
}

/** Screen measurements become paint-only world coordinates; layout stays authoritative. */
export function resolveSpaceCaptionGaps(
  region: SpaceCaptionBounds,
  captions: readonly SpaceCaptionBounds[],
  zoom: number,
  strokeWidth: number,
): SpaceCaptionGap[] {
  if (!Number.isFinite(zoom) || zoom <= 0 || region.right <= region.left) {
    return []
  }
  const width = (region.right - region.left) / zoom
  const padding = Math.min(3 / zoom, 20)
  const gaps = captions
    .filter(
      caption =>
        [caption.left, caption.right, caption.top, caption.bottom].every(Number.isFinite) &&
        caption.right > caption.left &&
        caption.bottom > caption.top &&
        caption.top <= region.top + strokeWidth * zoom &&
        caption.bottom >= region.top,
    )
    .map(caption => ({
      start: Math.max(0, (caption.left - region.left) / zoom - padding),
      end: Math.min(width, (caption.right - region.left) / zoom + padding),
    }))
    .filter(gap => gap.end > gap.start)
    .sort((a, b) => a.start - b.start)
  const merged: SpaceCaptionGap[] = []
  for (const gap of gaps) {
    const previous = merged.at(-1)
    if (previous && gap.start <= previous.end) {
      previous.end = Math.max(previous.end, gap.end)
    } else {
      merged.push({ ...gap })
    }
  }
  return merged
}

export function buildSpaceCaptionBorderClip(gaps: readonly SpaceCaptionGap[]): string {
  if (gaps.length === 0) {
    return 'none'
  }
  const depth = 'calc(3px * var(--cove-space-stroke-scale) + 1px)'
  const points = ['0 0']
  for (const gap of gaps) {
    const start = `${gap.start.toFixed(3)}px`
    const end = `${gap.end.toFixed(3)}px`
    points.push(`${start} 0`, `${start} ${depth}`, `${end} ${depth}`, `${end} 0`)
  }
  return `polygon(${[...points, '100% 0', '100% 100%', '0 100%'].join(', ')})`
}
