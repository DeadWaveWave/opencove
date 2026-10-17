export type WaitDuration =
  | { unit: 'unknown' }
  | { unit: 'now' }
  | { unit: 'minutes'; count: number }
  | { unit: 'hours'; count: number }

/** How long ago an agent started waiting, in the coarse steps the inbox shows. */
export function resolveWaitDuration(waitingSinceMs: number | null, nowMs: number): WaitDuration {
  if (waitingSinceMs === null) {
    return { unit: 'unknown' }
  }
  const minutes = Math.floor(Math.max(0, nowMs - waitingSinceMs) / 60_000)
  if (minutes < 1) {
    return { unit: 'now' }
  }
  if (minutes < 60) {
    return { unit: 'minutes', count: minutes }
  }
  return { unit: 'hours', count: Math.floor(minutes / 60) }
}
