import { useCallback, useSyncExternalStore, type RefObject } from 'react'
import { CANVAS_LOD_ATTRIBUTE, type CanvasLod } from './canvasLod'
import { SPACE_VISUAL_SCALE_EVENT } from './spaceVisualScale'

/**
 * Reads the canvas root's level of detail, which useSpaceVisualScale writes. Components re-render
 * only when the level steps, never on the zoom steps in between.
 */
export function useCanvasLod(scopeRef: RefObject<HTMLDivElement | null>): CanvasLod {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const scope = scopeRef.current
      scope?.addEventListener(SPACE_VISUAL_SCALE_EVENT, onChange)
      return () => scope?.removeEventListener(SPACE_VISUAL_SCALE_EVENT, onChange)
    },
    [scopeRef],
  )
  return useSyncExternalStore(
    subscribe,
    () => (scopeRef.current?.getAttribute(CANVAS_LOD_ATTRIBUTE) === 'far' ? 'far' : 'near'),
    () => 'near',
  )
}
