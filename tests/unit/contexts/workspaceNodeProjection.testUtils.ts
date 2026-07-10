import type { Node } from '@xyflow/react'
import { expect } from 'vitest'
import type {
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { SPACE_NODE_PADDING } from '../../../src/contexts/workspace/presentation/renderer/utils/spaceLayout'

const baseNode = {
  type: 'terminalNode',
  data: {
    sessionId: 's1',
    title: 'terminal',
    width: 120,
    height: 80,
    kind: 'terminal',
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    agent: null,
    task: null,
    note: null,
  } satisfies TerminalNodeData,
}

type DragProjection = {
  targetSpaceId: string | null
  nextNodePositionById: Map<string, { x: number; y: number }>
} | null

export function createNode({
  id,
  position,
  width = baseNode.data.width,
  height = baseNode.data.height,
}: {
  id: string
  position: { x: number; y: number }
  width?: number
  height?: number
}): Node<TerminalNodeData> {
  return {
    ...baseNode,
    id,
    position,
    data: {
      ...baseNode.data,
      sessionId: `session-${id}`,
      title: id,
      width,
      height,
    },
  }
}

export function createSpace({
  id,
  rect,
  nodeIds,
  parentSpaceId,
}: {
  id: string
  rect: WorkspaceSpaceRect
  nodeIds: string[]
  parentSpaceId?: string
}): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: `/tmp/${id}`,
    targetMountId: null,
    parentSpaceId,
    nodeIds,
    rect,
  }
}

export function rectForPosition(
  node: Node<TerminalNodeData>,
  position: { x: number; y: number },
): WorkspaceSpaceRect {
  return {
    x: position.x,
    y: position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

export function intersects(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  return !(
    a.x + a.width <= b.x ||
    a.x >= b.x + b.width ||
    a.y + a.height <= b.y ||
    a.y >= b.y + b.height
  )
}

export function expectProjectedPosition(
  projection: DragProjection,
  nodeId: string,
): { x: number; y: number } {
  expect(projection, `${nodeId}: projection should exist`).not.toBeNull()
  const position = projection?.nextNodePositionById.get(nodeId)
  expect(position, `${nodeId}: projected position should exist`).toBeDefined()
  return position!
}

export function expectInsideSpaceWithPadding(
  rect: WorkspaceSpaceRect,
  spaceRect: WorkspaceSpaceRect,
  label: string,
): void {
  expect(rect.x, `${label}: left`).toBeGreaterThanOrEqual(spaceRect.x + SPACE_NODE_PADDING)
  expect(rect.y, `${label}: top`).toBeGreaterThanOrEqual(spaceRect.y + SPACE_NODE_PADDING)
  expect(rect.x + rect.width, `${label}: right`).toBeLessThanOrEqual(
    spaceRect.x + spaceRect.width - SPACE_NODE_PADDING,
  )
  expect(rect.y + rect.height, `${label}: bottom`).toBeLessThanOrEqual(
    spaceRect.y + spaceRect.height - SPACE_NODE_PADDING,
  )
}
