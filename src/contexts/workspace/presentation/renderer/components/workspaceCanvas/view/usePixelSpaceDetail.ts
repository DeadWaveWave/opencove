import { useLayoutEffect, type RefObject } from 'react'
import { useStore } from '@xyflow/react'
import type { UiTheme } from '@contexts/settings/domain/uiSettings'
import { resolvePixelDetail } from './pixelLayer/grid'

/** Space material follows zoom even when every optional pixel effect is disabled. */
export function usePixelSpaceDetail(scopeRef: RefObject<HTMLDivElement | null>, theme: UiTheme) {
  const zoom = useStore(state => state.transform[2])
  useLayoutEffect(() => {
    const scope = scopeRef.current
    if (!scope || theme !== 'pixel') {
      return
    }
    const property = '--cove-pixel-space-detail'
    const previous = scope.style.getPropertyValue(property)
    const detail = resolvePixelDetail(zoom).toFixed(3)
    scope.style.setProperty(property, detail)
    return () => {
      if (scope.style.getPropertyValue(property) === detail) {
        if (previous) {
          scope.style.setProperty(property, previous)
        } else {
          scope.style.removeProperty(property)
        }
      }
    }
  }, [scopeRef, theme, zoom])
}
