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

  it('expands child and ancestor spaces when resizing a child-owned node outward', () => {
    const nodes: Node<TerminalNodeData>[] = [
      createTerminalNode({
        id: 'child-space-terminal',
        title: 'terminal-in-child-space',
        x: 140,
        y: 140,
        width: 180,
        height: 120,
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'resize-parent-space',
        name: 'Resize Parent Space',
        directoryPath: '/tmp/workspace',
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: { x: 100, y: 100, width: 360, height: 260 },
      },
      {
        id: 'resize-child-space',
        name: 'Resize Child Space',
        directoryPath: '/tmp/workspace',
        targetMountId: null,
        parentSpaceId: 'resize-parent-space',
        labelColor: null,
        nodeIds: ['child-space-terminal'],
        rect: { x: 120, y: 120, width: 220, height: 160 },
      },
    ]

    const resolved = resolveWorkspaceLayoutAfterNodeResize({
      nodeId: 'child-space-terminal',
      desiredFrame: {
        position: { x: 140, y: 140 },
        size: { width: 520, height: 260 },
      },
      nodes,
      spaces,
      gap: 0,
    })

    expect(resolved).not.toBeNull()

    const nextNode = resolved?.nodes.find(node => node.id === 'child-space-terminal') ?? null
    const parent = resolved?.spaces.find(space => space.id === 'resize-parent-space') ?? null
    const child = resolved?.spaces.find(space => space.id === 'resize-child-space') ?? null

    expect(nextNode?.position).toEqual({ x: 140, y: 140 })
    expect(nextNode?.data.width).toBe(520)
    expect(nextNode?.data.height).toBe(260)
    expect(child?.rect?.x).toBeLessThanOrEqual(140 - 24)
    expect(child?.rect?.x ?? 0).toBeGreaterThanOrEqual(parent?.rect?.x ?? 0)
    expect((child?.rect?.x ?? 0) + (child?.rect?.width ?? 0)).toBeGreaterThanOrEqual(140 + 520 + 24)
    expect((parent?.rect?.x ?? 0) + (parent?.rect?.width ?? 0)).toBeGreaterThanOrEqual(
      (child?.rect?.x ?? 0) + (child?.rect?.width ?? 0) + 24,
    )
  })

  it('does not push child spaces out when resizing a parent-owned node outward', () => {
    const nodes: Node<TerminalNodeData>[] = [
      createTerminalNode({
        id: 'parent-space-terminal',
        title: 'terminal-in-parent-space',
        x: 140,
        y: 140,
        width: 180,
        height: 120,
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'parent-node-resize-space',
        name: 'Parent Node Resize Space',
        directoryPath: '/tmp/workspace',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['parent-space-terminal'],
        rect: { x: 100, y: 100, width: 340, height: 260 },
      },
      {
        id: 'stable-child-space',
        name: 'Stable Child Space',
        directoryPath: '/tmp/workspace',
        targetMountId: null,
        parentSpaceId: 'parent-node-resize-space',
        labelColor: null,
        nodeIds: [],
        rect: { x: 300, y: 150, width: 120, height: 120 },
      },
    ]

    const resolved = resolveWorkspaceLayoutAfterNodeResize({
      nodeId: 'parent-space-terminal',
      desiredFrame: {
        position: { x: 140, y: 140 },
        size: { width: 480, height: 260 },
      },
      nodes,
      spaces,
      gap: 0,
    })

    expect(resolved).not.toBeNull()

    const parent = resolved?.spaces.find(space => space.id === 'parent-node-resize-space') ?? null
    const child = resolved?.spaces.find(space => space.id === 'stable-child-space') ?? null

    expect(child?.rect).toEqual(spaces[1]?.rect)
    expect(parent?.rect?.width).toBeGreaterThan(340)
    expect(parent?.rect?.height).toBeGreaterThan(260)
    expect((child?.rect?.x ?? 0) + (child?.rect?.width ?? 0)).toBeLessThanOrEqual(
      (parent?.rect?.x ?? 0) + (parent?.rect?.width ?? 0),
    )
    expect((child?.rect?.y ?? 0) + (child?.rect?.height ?? 0)).toBeLessThanOrEqual(
      (parent?.rect?.y ?? 0) + (parent?.rect?.height ?? 0),
    )
  })

  it('moves child spaces with their parent when a root node resize pushes the parent tree', () => {
    const nodes: Node<TerminalNodeData>[] = [
      createTerminalNode({
        id: 'root-resize-source',
        title: 'root-resize-source',
        x: 100,
        y: 100,
        width: 260,
        height: 180,
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'pushed-parent-space',
        name: 'Pushed Parent Space',
        directoryPath: '/tmp/workspace',
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: { x: 430, y: 100, width: 320, height: 260 },
      },
      {
        id: 'pushed-child-space',
        name: 'Pushed Child Space',
        directoryPath: '/tmp/workspace',
        targetMountId: null,
        parentSpaceId: 'pushed-parent-space',
        labelColor: null,
        nodeIds: [],
        rect: { x: 480, y: 150, width: 120, height: 120 },
      },
    ]

    const resolved = resolveWorkspaceLayoutAfterNodeResize({
      nodeId: 'root-resize-source',
      desiredFrame: {
        position: { x: 100, y: 100 },
        size: { width: 420, height: 180 },
      },
      nodes,
      spaces,
      gap: 0,
    })

    expect(resolved).not.toBeNull()

    const parent = resolved?.spaces.find(space => space.id === 'pushed-parent-space') ?? null
    const child = resolved?.spaces.find(space => space.id === 'pushed-child-space') ?? null
    const parentDx = (parent?.rect?.x ?? 0) - (spaces[0]?.rect?.x ?? 0)
    const parentDy = (parent?.rect?.y ?? 0) - (spaces[0]?.rect?.y ?? 0)

    expect(parentDx).toBeGreaterThan(0)
    expect(child?.rect?.x).toBe((spaces[1]?.rect?.x ?? 0) + parentDx)
    expect(child?.rect?.y).toBe((spaces[1]?.rect?.y ?? 0) + parentDy)
    expect((child?.rect?.x ?? 0) + (child?.rect?.width ?? 0)).toBeLessThanOrEqual(
      (parent?.rect?.x ?? 0) + (parent?.rect?.width ?? 0),
    )
    expect((child?.rect?.y ?? 0) + (child?.rect?.height ?? 0)).toBeLessThanOrEqual(
      (parent?.rect?.y ?? 0) + (parent?.rect?.height ?? 0),
    )
  })
})
