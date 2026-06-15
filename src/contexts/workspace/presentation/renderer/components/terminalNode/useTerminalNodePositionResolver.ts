import { useCallback, useRef } from 'react'
import type { Point } from '../../types'

export function useTerminalNodePositionResolver({
  position,
  getPosition,
}: {
  position?: Point
  getPosition?: () => Point
}): () => Point {
  const fallbackPositionRef = useRef(position ?? { x: 0, y: 0 })

  if (position) {
    fallbackPositionRef.current = position
  }

  return useCallback(() => getPosition?.() ?? fallbackPositionRef.current, [getPosition])
}
