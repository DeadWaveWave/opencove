import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../../types'
import { resolveWindowKindFamily } from '../../../../utils/windowKindFamily'
import { CANVAS_LOD_ATTRIBUTE } from '../canvasLod'
import { SPACE_VISUAL_SCALE_EVENT } from '../spaceVisualScale'
import { subscribeWindowSignal } from '../windowSignals/windowSignalEvents'
import { projectPixelNodeFrame, readPixelViewport, type PixelGeometryNode } from './geometry'
import type { PixelTheme } from './renderer'
import { createPixelSparks, type PixelSparkKind } from './sparks'

/** Routes existing visual events; it never infers a completed run or writes LOD. */
export function createPixelSignalSparks({
  scope,
  enabled,
  readScene,
  invalidate,
}: {
  scope: Element
  enabled: () => boolean
  readScene: () => {
    nodes: Node<TerminalNodeData>[]
    theme: PixelTheme
    state: {
      transform: [number, number, number]
      width: number
      height: number
      nodeLookup: ReadonlyMap<string, PixelGeometryNode>
    }
  }
  invalidate: () => void
}) {
  const field = createPixelSparks()
  const root = scope.closest('.workspace-canvas') ?? scope
  let lod = root.getAttribute(CANVAS_LOD_ATTRIBUTE)
  const spawn = (kind: PixelSparkKind, nodeId?: string) => {
    if (!enabled()) {
      return
    }
    const { nodes, state, theme } = readScene()
    // The LOD owner can publish before the layer's store subscriber: read current geometry here.
    const viewport = readPixelViewport(state)
    if (viewport.zoom <= 0) {
      return
    }
    const now = performance.now()
    for (const node of nodes) {
      if ((nodeId && node.id !== nodeId) || node.data.collapsePresentation?.collapsed) {
        continue
      }
      const frame = projectPixelNodeFrame(node, state.nodeLookup, viewport, 0)
      if (!frame) {
        continue
      }
      const rect = {
        x: (frame.rect.x - viewport.x) / viewport.zoom,
        y: (frame.rect.y - viewport.y) / viewport.zoom,
        width: frame.rect.width / viewport.zoom,
        height: frame.rect.height / viewport.zoom,
      }
      field.spawn(
        kind,
        rect,
        kind === 'fail'
          ? theme.danger
          : (theme.ink?.[resolveWindowKindFamily(node.data)] ?? theme.blue),
        now,
      )
    }
    invalidate()
  }
  const onLod = () => {
    const next = root.getAttribute(CANVAS_LOD_ATTRIBUTE)
    const changed = lod !== null && next !== null && lod !== next
    lod = next
    if (changed) {
      spawn('lod')
    }
  }
  root.addEventListener(SPACE_VISUAL_SCALE_EVENT, onLod)
  const unsubscribe = subscribeWindowSignal(signal => spawn(signal.kind, signal.nodeId))
  return {
    sample: (now: number) => field.sample(now),
    clear: () => field.clear(),
    dispose: () => {
      field.clear()
      unsubscribe()
      root.removeEventListener(SPACE_VISUAL_SCALE_EVENT, onLod)
    },
  }
}
