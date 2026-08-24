export const terminalRasterScaleLevels = [1, 1.25, 1.5, 1.75] as const

export type TerminalRasterScale = (typeof terminalRasterScaleLevels)[number]

const terminalRasterDowngradeHysteresis = 0.05

export function resolveTerminalRasterScale({
  canvasZoom,
  currentScale,
}: {
  readonly canvasZoom: number
  readonly currentScale: number
}): TerminalRasterScale {
  if (!Number.isFinite(canvasZoom) || canvasZoom <= 0) {
    return 1
  }

  const desiredScale =
    terminalRasterScaleLevels.find(scale => scale >= canvasZoom) ??
    terminalRasterScaleLevels.at(-1)!
  const normalizedCurrentScale = terminalRasterScaleLevels.includes(
    currentScale as TerminalRasterScale,
  )
    ? (currentScale as TerminalRasterScale)
    : 1

  if (desiredScale >= normalizedCurrentScale) {
    return desiredScale
  }

  const currentIndex = terminalRasterScaleLevels.indexOf(normalizedCurrentScale)
  const lowerBoundary = terminalRasterScaleLevels[currentIndex - 1]
  if (
    lowerBoundary !== undefined &&
    canvasZoom > lowerBoundary - terminalRasterDowngradeHysteresis
  ) {
    return normalizedCurrentScale
  }

  return desiredScale
}
