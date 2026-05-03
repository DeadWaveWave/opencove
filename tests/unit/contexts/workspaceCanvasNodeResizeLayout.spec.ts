import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { resolveWorkspaceLayoutAfterNodeResize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.resolveResizeLayout'

function createTerminalNode({
  id,
  x,
  y,
  width,
  height,
  title,
}: {
  id: string
  x: number
  y: number
  width: number
  height: number
  title: string
}): Node<TerminalNodeData> {
  return {
    id,
    type: 'terminal',
    position: { x, y },
    data: {
      sessionId: `${id}-session`,
      title,
      width,
      height,
      kind: 'terminal',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: '/tmp/workspace',
      expectedDirectory: '/tmp/workspace',
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    },
  }
}

function rectsOverlap(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  const aRight = a.x + a.width
  const aBottom = a.y + a.height
  const bRight = b.x + b.width
  const bBottom = b.y + b.height

  return !(aRight <= b.x || a.x >= bRight || aBottom <= b.y || a.y >= bBottom)
}

describe('resolveWorkspaceLayoutAfterNodeResize', () => {
  it('expands the owning space and keeps root nodes clear when a node grows outward', () => {
    const nodes: Node<TerminalNodeData>[] = [
      createTerminalNode({
        id: 'space-resize-terminal',
        title: 'terminal-in-space',
        x: 140,
        y: 140,
        width: 460,
        height: 300,
      }),
      createTerminalNode({
        id: 'root-blocking-resize',
        title: 'root-blocking-resize',
        x: 740,
        y: 140,
        width: 460,
        height: 300,
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-resize',
        name: 'Resize Space',
        directoryPath: '/tmp/workspace',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['space-resize-terminal'],
        rect: { x: 100, y: 100, width: 600, height: 400 },
      },
    ]

    const resolved = resolveWorkspaceLayoutAfterNodeResize({
      nodeId: 'space-resize-terminal',
      desiredFrame: {
        position: { x: 140, y: 140 },
        size: { width: 640, height: 420 },
      },
      nodes,
      spaces,
      gap: 0,
    })

    expect(resolved).not.toBeNull()

    const nextNode = resolved?.nodes.find(node => node.id === 'space-resize-terminal') ?? null
    const nextRoot = resolved?.nodes.find(node => node.id === 'root-blocking-resize') ?? null
    const nextSpace = resolved?.spaces.find(space => space.id === 'space-resize') ?? null

    expect(nextNode).not.toBeNull()
    expect(nextRoot).not.toBeNull()
    expect(nextSpace?.rect).not.toBeNull()

    expect(nextNode?.position).toEqual({ x: 140, y: 140 })
    expect(nextNode?.data.width).toBe(640)
    expect(nextNode?.data.height).toBe(420)

    const nextSpaceRect = nextSpace?.rect as WorkspaceSpaceRect
    expect(nextSpaceRect.width).toBeGreaterThan(600)
    expect(nextSpaceRect.height).toBeGreaterThan(400)

    const nextNodeRect: WorkspaceSpaceRect = {
      x: nextNode?.position.x ?? 0,
      y: nextNode?.position.y ?? 0,
      width: nextNode?.data.width ?? 0,
      height: nextNode?.data.height ?? 0,
    }
    const nextRootRect: WorkspaceSpaceRect = {
      x: nextRoot?.position.x ?? 0,
      y: nextRoot?.position.y ?? 0,
      width: nextRoot?.data.width ?? 0,
      height: nextRoot?.data.height ?? 0,
    }

    expect(nextNodeRect.x).toBeGreaterThanOrEqual(nextSpaceRect.x)
    expect(nextNodeRect.y).toBeGreaterThanOrEqual(nextSpaceRect.y)
    expect(nextNodeRect.x + nextNodeRect.width).toBeLessThanOrEqual(
      nextSpaceRect.x + nextSpaceRect.width,
    )
    expect(nextNodeRect.y + nextNodeRect.height).toBeLessThanOrEqual(
      nextSpaceRect.y + nextSpaceRect.height,
    )
    expect(rectsOverlap(nextRootRect, nextSpaceRect)).toBe(false)
  })
})
