const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value))

/** Screen-space flowing ridges. Distant canvases retain one broad, fine-grained
 * ribbon instead of magnifying background blocks relative to the tiny nodes. */
export function createPixelFieldColumn(
  x: number,
  height: number,
  now: number,
  reducedMotion: boolean,
  detail = 1,
) {
  const time = reducedMotion ? 0 : now / 1000
  const firstRidge =
    height * 0.44 +
    Math.sin(x * 0.0048 + time * 0.25) * 64 +
    Math.cos(x * 0.0027 - time * 0.18) * 28
  const secondRidge = height * 0.73 + Math.sin(x * 0.0038 - time * 0.2) * 42
  const breathPhase = x * 0.01 + time * 0.45

  return (y: number, noise: number) => {
    const firstDistance = (y - firstRidge) / (70 + (1 - detail) * 32)
    const secondDistance = (y - secondRidge) / 54
    const ridge =
      Math.exp(-firstDistance * firstDistance) * 0.82 +
      Math.exp(-secondDistance * secondDistance) * 0.42 * detail
    const breathe =
      0.97 - detail * 0.07 + (0.03 + detail * 0.07) * Math.sin(breathPhase - y * 0.006)
    return {
      size: Math.max(
        1,
        clamp(1 + ridge * (0.6 + noise * 0.7) * (0.45 + detail * 1.8), 1.6 + detail * 2.4),
      ),
      alpha: clamp(
        0.012 +
          detail * 0.038 +
          ridge * (0.08 + detail * 0.27 + noise * (0.05 + detail * 0.25)) * breathe,
        0.8,
      ),
    }
  }
}

/** Three sparse fronts travel at the showcase's 33 pixels per second. */
export function resolvePixelScanFront(
  lane: number,
  y: number,
  width: number,
  now: number,
  noise: number,
  detail = 1,
) {
  const travelWidth = width + 180
  const front = ((now * 0.033 + (lane * travelWidth) / 3) % travelWidth) - 90
  return {
    x: front + Math.sin(y * 0.012 + lane) * 36,
    size: 1.1 + noise * 1.4 * detail,
    alpha: (0.12 + noise * 0.2) * detail * detail,
  }
}
