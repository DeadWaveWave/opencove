const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value))

/** The showcase's two moving Gaussian ridges, evaluated once per grid column.
 * Grid positions and stable noise stay separate from decorative wave time. */
export function createPixelFieldColumn(
  x: number,
  height: number,
  now: number,
  reducedMotion: boolean,
) {
  const time = reducedMotion ? 0 : now / 1000
  const firstRidge =
    height * 0.42 + Math.sin(x * 0.006 + time * 0.32) * 76 + Math.cos(x * 0.003 - time * 0.27) * 40
  const secondRidge = height * 0.71 + Math.sin(x * 0.005 - time * 0.23) * 63
  const breathPhase = x * 0.017 + time * 0.75

  return (y: number, noise: number) => {
    const firstDistance = (y - firstRidge) / 53
    const secondDistance = (y - secondRidge) / 35
    const ridge =
      Math.exp(-firstDistance * firstDistance) * 0.75 +
      Math.exp(-secondDistance * secondDistance) * 0.5
    const breathe = 0.74 + 0.26 * Math.sin(breathPhase - y * 0.013)
    return {
      size: Math.max(2, clamp(2 + ridge * (2.5 + noise * 3.5), 7)),
      alpha: clamp(0.075 + ridge * (0.32 + noise * 0.38) * breathe, 0.9),
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
) {
  const travelWidth = width + 180
  const front = ((now * 0.033 + (lane * travelWidth) / 3) % travelWidth) - 90
  return {
    x: front + Math.sin(y * 0.012 + lane) * 36,
    size: 2 + noise * 3,
    alpha: 0.17 + noise * 0.3,
  }
}
