import { useLayoutEffect, type RefObject } from 'react'
import { useStore } from '@xyflow/react'
import { resolveSpaceVisualScale, SPACE_VISUAL_SCALE_EVENT } from './spaceVisualScale'

/** Canvas projection owns these transient values independently of themes and effects. */
export function useSpaceVisualScale(scopeRef: RefObject<HTMLDivElement | null>) {
  const zoom = useStore(state => state.transform[2])
  useLayoutEffect(() => {
    const scope = scopeRef.current
    if (!scope) {
      return
    }
    const scale = resolveSpaceVisualScale(zoom)
    const overviewAttribute = 'data-cove-space-overview'
    const previousOverview = scope.getAttribute(overviewAttribute)
    const overviewValue = String(scale.overview)
    const properties = [
      ['--cove-canvas-zoom', String(scale.zoom)],
      ['--cove-space-detail', scale.detail.toFixed(3)],
      ['--cove-space-annotation-scale', String(scale.annotation)],
      ['--cove-space-stroke-scale', String(scale.stroke)],
    ].map(([property, value]) => ({
      property,
      value,
      previous: scope.style.getPropertyValue(property),
    }))
    for (const { property, value } of properties) {
      scope.style.setProperty(property, value)
    }
    scope.setAttribute(overviewAttribute, overviewValue)
    scope.dispatchEvent(new Event(SPACE_VISUAL_SCALE_EVENT))
    return () => {
      for (const { property, value, previous } of properties) {
        if (scope.style.getPropertyValue(property) !== value) {
          continue
        }
        if (previous) {
          scope.style.setProperty(property, previous)
        } else {
          scope.style.removeProperty(property)
        }
      }
      if (scope.getAttribute(overviewAttribute) === overviewValue) {
        if (previousOverview === null) {
          scope.removeAttribute(overviewAttribute)
        } else {
          scope.setAttribute(overviewAttribute, previousOverview)
        }
      }
    }
  }, [scopeRef, zoom])
}
