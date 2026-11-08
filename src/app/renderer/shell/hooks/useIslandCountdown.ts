import { useEffect, useRef } from 'react'

/**
 * A card's countdown: `onExpire` runs once `durationMs` of unpaused time has passed. Pausing
 * keeps what is left, so a card you hovered, or one that arrived while OpenCove was behind,
 * still gets its full time.
 */
export function useIslandCountdown({
  durationMs,
  paused,
  onExpire,
}: {
  durationMs: number
  paused: boolean
  onExpire: () => void
}): void {
  const remainingRef = useRef(durationMs)
  const onExpireRef = useRef(onExpire)
  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  const hasExpiredRef = useRef(false)

  useEffect(() => {
    if (paused || hasExpiredRef.current) {
      return undefined
    }

    const startedAt = Date.now()
    const timer = window.setTimeout(() => {
      hasExpiredRef.current = true
      onExpireRef.current()
    }, remainingRef.current)

    return () => {
      window.clearTimeout(timer)
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt))
    }
  }, [paused])
}
