import { useLayoutEffect, type RefObject } from 'react'
import { useStoreApi } from '@xyflow/react'
import { resolveSpaceVisualScale, SPACE_VISUAL_SCALE_EVENT } from './spaceVisualScale'

/** Space regions render through React Flow's viewport portal, outside the window tree. */
const SPACE_LAYER_SELECTOR = '.react-flow__viewport-portal'
const OVERVIEW_ATTRIBUTE = 'data-cove-space-overview'
const IDENTITY_STRIPE_PROPERTY = '--cove-node-identity-stripe-height'

interface InlineWrite {
  previous: string | null
  value: string
}

/**
 * Canvas projection owns these transient values independently of themes and effects. Zoom is read
 * from the store without rendering. Values that follow every zoom step live on the Space layer; the
 * canvas root, which every window inherits from, changes only when the stripe or overview steps.
 */
export function useSpaceVisualScale(scopeRef: RefObject<HTMLDivElement | null>) {
  const store = useStoreApi()

  useLayoutEffect(() => {
    let disposed = false
    let zoom = Number.NaN
    let layer: HTMLElement | null = null
    const properties = new Map<HTMLElement, Map<string, InlineWrite>>()
    const attributes = new Map<HTMLElement, InlineWrite>()

    const writeProperty = (element: HTMLElement, property: string, value: string) => {
      const current = element.style.getPropertyValue(property)
      if (current === value) {
        return
      }
      const writes = properties.get(element) ?? new Map<string, InlineWrite>()
      properties.set(element, writes)
      const write = writes.get(property) ?? { previous: current, value }
      write.value = value
      writes.set(property, write)
      element.style.setProperty(property, value)
    }

    const writeOverview = (element: HTMLElement, value: string) => {
      const current = element.getAttribute(OVERVIEW_ATTRIBUTE)
      if (current === value) {
        return
      }
      const write = attributes.get(element) ?? { previous: current, value }
      write.value = value
      attributes.set(element, write)
      element.setAttribute(OVERVIEW_ATTRIBUTE, value)
    }

    const apply = (nextZoom: number): boolean => {
      const scope = scopeRef.current
      if (!scope) {
        return false
      }
      if (!layer?.isConnected) {
        layer = scope.querySelector<HTMLElement>(SPACE_LAYER_SELECTOR)
      }
      zoom = nextZoom
      const scale = resolveSpaceVisualScale(nextZoom)
      if (layer) {
        writeProperty(layer, '--cove-canvas-zoom', String(scale.zoom))
        writeProperty(layer, '--cove-space-detail', scale.detail.toFixed(3))
        writeProperty(layer, '--cove-space-annotation-scale', String(scale.annotation))
        writeProperty(layer, '--cove-space-stroke-scale', String(scale.stroke))
      }
      writeProperty(scope, IDENTITY_STRIPE_PROPERTY, `${scale.identityStripe}px`)
      writeOverview(scope, String(scale.overview))
      scope.dispatchEvent(new Event(SPACE_VISUAL_SCALE_EVENT))
      return true
    }

    if (!apply(store.getState().transform[2])) {
      // A parent's ref attaches after its children's layout effects; the commit has finished here.
      queueMicrotask(() => {
        if (!disposed && Number.isNaN(zoom)) {
          apply(store.getState().transform[2])
        }
      })
    }
    const unsubscribe = store.subscribe(state => {
      if (state.transform[2] !== zoom) {
        apply(state.transform[2])
      }
    })

    return () => {
      disposed = true
      unsubscribe()
      for (const [element, writes] of properties) {
        for (const [property, write] of writes) {
          if (element.style.getPropertyValue(property) !== write.value) {
            continue
          }
          if (write.previous) {
            element.style.setProperty(property, write.previous)
          } else {
            element.style.removeProperty(property)
          }
        }
      }
      for (const [element, write] of attributes) {
        if (element.getAttribute(OVERVIEW_ATTRIBUTE) !== write.value) {
          continue
        }
        if (write.previous === null) {
          element.removeAttribute(OVERVIEW_ATTRIBUTE)
        } else {
          element.setAttribute(OVERVIEW_ATTRIBUTE, write.previous)
        }
      }
    }
  }, [scopeRef, store])
}
