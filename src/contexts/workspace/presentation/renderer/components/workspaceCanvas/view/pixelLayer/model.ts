import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../../types'
import { resolveAgentPresentation } from '../../../../utils/agentPresentation'
import { projectPixelNodeFrame, type PixelGeometryNode, type PixelViewport } from './geometry'
export { readPixelViewport } from './geometry'
export type { PixelViewport } from './geometry'
export { resolvePixelGrid } from './grid'

export interface PixelNode {
  id: string
  sessionId: string
  rect: { x: number; y: number; width: number; height: number }
  tone: 'working' | 'warning' | 'danger' | null
  acceptsOutput: boolean
}

export function projectPixelNodes(
  nodes: Node<TerminalNodeData>[],
  nodeLookup: ReadonlyMap<string, PixelGeometryNode>,
  viewport: PixelViewport,
): PixelNode[] {
  const projected: PixelNode[] = []
  for (const node of nodes) {
    if (
      node.data.collapsePresentation?.collapsed ||
      (node.data.kind !== 'agent' && node.data.kind !== 'terminal')
    ) {
      continue
    }
    const frame = projectPixelNodeFrame(node, nodeLookup, viewport)
    if (!frame) {
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
      ...frame,
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
