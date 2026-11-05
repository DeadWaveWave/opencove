import { useLayoutEffect, type RefObject } from 'react'
import { useStoreApi } from '@xyflow/react'
import { resolveSpaceVisualScale, SPACE_VISUAL_SCALE_EVENT } from './spaceVisualScale'
import { CANVAS_LOD_ATTRIBUTE, resolveCanvasLod, type CanvasLod } from './canvasLod'

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
 * canvas root, which every window inherits from, changes only when the stripe, overview or level of
 * detail steps. It is the only writer of the level of detail (`data-cove-lod`).
 */
export function useSpaceVisualScale(
  scopeRef: RefObject<HTMLDivElement | null>,
  { farViewEnabled = true }: { farViewEnabled?: boolean } = {},
) {
  const store = useStoreApi()

  useLayoutEffect(() => {
    let disposed = false
    let zoom = Number.NaN
    let layer: HTMLElement | null = null
    let lod: CanvasLod = 'near'
    const properties = new Map<HTMLElement, Map<string, InlineWrite>>()
    const attributes = new Map<string, { element: HTMLElement; write: InlineWrite }>()

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

    const writeAttribute = (element: HTMLElement, name: string, value: string) => {
      const current = element.getAttribute(name)
      if (current === value) {
        return
      }
      const entry = attributes.get(name)
      const write = entry?.element === element ? entry.write : { previous: current, value }
      write.value = value
      attributes.set(name, { element, write })
      element.setAttribute(name, value)
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
      writeAttribute(scope, OVERVIEW_ATTRIBUTE, String(scale.overview))
      lod = resolveCanvasLod(nextZoom, lod, farViewEnabled)
      writeAttribute(scope, CANVAS_LOD_ATTRIBUTE, lod)
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
      for (const [name, { element, write }] of attributes) {
        if (element.getAttribute(name) !== write.value) {
          continue
        }
        if (write.previous === null) {
          element.removeAttribute(name)
        } else {
          element.setAttribute(name, write.previous)
        }
      }
    }
  }, [farViewEnabled, scopeRef, store])
}
