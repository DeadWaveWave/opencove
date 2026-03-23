export function resolveMouseClientPoint(
  event: React.MouseEvent | MouseEvent,
): { x: number; y: number } | null {
  const resolve = (x: unknown, y: unknown): { x: number; y: number } | null => {
    if (typeof x !== 'number' || typeof y !== 'number') {
      return null
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null
    }

    return { x, y }
  }

  if ('clientX' in event) {
    const direct = resolve(event.clientX, event.clientY)
    if (direct) {
      return direct
    }
  }

  if ('nativeEvent' in event) {
    const native = (event as React.MouseEvent).nativeEvent as unknown as {
      clientX?: unknown
      clientY?: unknown
    } | null
    if (native) {
      const fallback = resolve(native.clientX, native.clientY)
      if (fallback) {
        return fallback
      }
    }
  }

  return null
}
