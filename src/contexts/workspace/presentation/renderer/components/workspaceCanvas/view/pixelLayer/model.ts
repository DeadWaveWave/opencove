import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../../types'
import { resolveAgentPresentation } from '../../../../utils/agentPresentation'

export interface PixelViewport {
  x: number
  y: number
  zoom: number
  width: number
  height: number
}

type PixelGeometryNode = Pick<
  Node<TerminalNodeData>,
  'position' | 'measured' | 'width' | 'height'
> & {
  internals?: { positionAbsolute: { x: number; y: number } }
}

export interface PixelNode {
  id: string
  sessionId: string
  rect: { x: number; y: number; width: number; height: number }
  tone: 'working' | 'warning' | 'danger' | null
  acceptsOutput: boolean
}

export function readPixelViewport(state: {
  transform: [number, number, number]
  width: number
  height: number
}): PixelViewport {
  const [x, y, zoom] = state.transform
  return { x, y, zoom, width: Math.max(0, state.width), height: Math.max(0, state.height) }
}

export function projectPixelNodes(
  nodes: Node<TerminalNodeData>[],
  nodeLookup: ReadonlyMap<string, PixelGeometryNode>,
  viewport: PixelViewport,
): PixelNode[] {
  const projected: PixelNode[] = []
  for (const node of nodes) {
    if (
      node.hidden ||
      node.className?.split(/\s+/).includes('cove-node--filtered-out') ||
      (node.data.kind !== 'agent' && node.data.kind !== 'terminal')
    ) {
      continue
    }
    const geometry = nodeLookup.get(node.id)
    // A child position is local to its parent. Wait for ReactFlow's absolute measurement.
    if (node.parentId && !geometry?.internals?.positionAbsolute) {
      continue
    }
    const position = geometry?.internals?.positionAbsolute ?? geometry?.position ?? node.position
    const rect = {
      x: position.x * viewport.zoom + viewport.x,
      y: position.y * viewport.zoom + viewport.y,
      width: (geometry?.measured?.width ?? geometry?.width ?? node.data.width) * viewport.zoom,
      height: (geometry?.measured?.height ?? geometry?.height ?? node.data.height) * viewport.zoom,
    }
    if (
      !Object.values(rect).every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.x + rect.width < -8 ||
      rect.y + rect.height < -8 ||
      rect.x > viewport.width + 8 ||
      rect.y > viewport.height + 8
    ) {
      continue
    }
    const presentation = resolveAgentPresentation(node.data)
    const status = presentation.status
    const unavailable =
      presentation.observation?.degraded === true ||
      status === 'restoring' ||
      node.data.status === 'restoring' ||
      Boolean(node.data.runtimeSessionBinding)
    projected.push({
      id: node.id,
      sessionId: node.data.sessionId,
      rect,
      tone: unavailable
        ? null
        : status === 'waiting'
          ? 'warning'
          : status === 'failed'
            ? 'danger'
            : status === 'running'
              ? 'working'
              : null,
      acceptsOutput:
        !unavailable && status !== 'failed' && status !== 'stopped' && status !== 'exited',
    })
  }
  return projected
}

export function resolvePixelBuffer(width: number, height: number, devicePixelRatio: number) {
  const dpr = Number.isFinite(devicePixelRatio) ? Math.max(1, Math.min(2, devicePixelRatio)) : 1
  return {
    width: Math.ceil(Math.max(0, width) * dpr),
    height: Math.ceil(Math.max(0, height) * dpr),
    dpr,
  }
}

export function resolvePixelGrid(viewport: PixelViewport, configuredGap: number) {
  const baseGap = Math.max(8, Number.isFinite(configuredGap) ? configuredGap : 17)
  const minimumScreenGap = Math.max(12, Math.sqrt((viewport.width * viewport.height) / 16000))
  const level = Math.max(0, Math.ceil(Math.log2(minimumScreenGap / (baseGap * viewport.zoom))))
  const worldGap = baseGap * 2 ** level
  const gap = worldGap * viewport.zoom
  return {
    gap,
    worldGap,
    firstColumn: Math.floor(-viewport.x / gap),
    firstRow: Math.floor(-viewport.y / gap),
  }
}

export function pixelNoise(column: number, row: number): number {
  let value = Math.imul(column | 0, 374761393) ^ Math.imul(row | 0, 668265263)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

const OUTPUT_DECAY_MS = 1050

/** Ephemeral output timestamps only; this object has no business-state write capability. */
export function createPixelActivity() {
  const outputByNode = new Map<string, { sessionId: string; receivedAt: number }>()
  return {
    observe(sessionId: string, nodes: PixelNode[], now: number): boolean {
      let observed = false
      for (const node of nodes) {
        if (!node.acceptsOutput || !sessionId || node.sessionId !== sessionId) {
          continue
        }
        outputByNode.set(node.id, { sessionId, receivedAt: now })
        observed = true
      }
      return observed
    },
    intensity(node: PixelNode, now: number): number {
      const output = outputByNode.get(node.id)
      if (!node.acceptsOutput || !output || output.sessionId !== node.sessionId) {
        return 0
      }
      const progress = Math.max(0, Math.min(1, (now - output.receivedAt) / OUTPUT_DECAY_MS))
      return 1 - progress * progress * (3 - 2 * progress)
    },
    prune(nodes: PixelNode[], now: number): void {
      const visible = new Map(nodes.map(node => [node.id, node]))
      for (const [id, output] of outputByNode) {
        const node = visible.get(id)
        if (
          !node?.acceptsOutput ||
          node.sessionId !== output.sessionId ||
          now - output.receivedAt >= OUTPUT_DECAY_MS
        ) {
          outputByNode.delete(id)
        }
      }
    },
    clear(): void {
      outputByNode.clear()
    },
  }
}

export type PixelActivity = ReturnType<typeof createPixelActivity>
