import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { projectWorkspaceSpaceDragLayout } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.finalize'
import { resolveResizedSpaceRect } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.preview'
import { createSpaceDragState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.startState'
import type { SpaceDragState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type {
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { getCollapsedNodeSize } from '../../../src/contexts/workspace/presentation/renderer/utils/canvasCollapse'
import { SPACE_MIN_SIZE } from '../../../src/contexts/workspace/presentation/renderer/utils/spaceLayout'

type Edges = Extract<SpaceDragState['handle'], { kind: 'resize' }>['edges']

function node(id: string, x: number, y: number, width = 640, height = 480): Node<TerminalNodeData> {
  return {
    id,
    type: 'terminal',
    position: { x, y },
    data: {
      sessionId: id,
      title: id,
      kind: 'terminal',
      width,
      height,
      status: 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    },
  }
}

function space(
  id: string,
  rect: WorkspaceSpaceRect,
  nodeIds: string[],
  parentSpaceId: string | null = null,
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/workspace',
    targetMountId: null,
    labelColor: null,
    parentSpaceId,
    nodeIds,
    rect,
  }
}

function resize({
  nodes,
  spaces,
  collapsedIds,
  edges = { right: true, bottom: true },
  dx,
  dy,
  spaceId = spaces[0].id,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  collapsedIds: string[]
  edges?: Edges
  dx: number
  dy: number
  spaceId?: string
}) {
  const dragState = createSpaceDragState({
    pointerId: 1,
    spaceId,
    startFlow: { x: 0, y: 0 },
    startClient: { x: 0, y: 0 },
    shiftKey: false,
    targetSpace: spaces.find(item => item.id === spaceId)!,
    handle: { kind: 'resize', edges },
    nodes,
    spaces,
    selectedNodeIds: [],
  })
  dragState.collapseState = {
    collapsedNodeIds: Object.fromEntries(collapsedIds.map(id => [id, true as const])),
    collapsedSpaceIds: {},
  }
  const projected = projectWorkspaceSpaceDragLayout({
    dragState,
    nodes,
    spaces,
    dx,
    dy,
    resolveResizedRect: resolveResizedSpaceRect,
  })
  expect(projected).not.toBeNull()
  return projected!
}

describe('Space resize with compact window geometry', () => {
  it.each<Edges>([
    { right: true },
    { bottom: true },
    { left: true },
    { top: true },
    { right: true, bottom: true },
    { left: true, bottom: true },
    { right: true, top: true },
    { left: true, top: true },
  ])('uses visible bounds for every edge and corner: %j', edges => {
    const terminal = node('terminal', edges.left ? 500 : 24, edges.top ? 400 : 24)
    const nodes = [terminal]
    const originalData = { ...terminal.data }
    const spaces = [space('root', { x: 0, y: 0, width: 900, height: 700 }, ['terminal'])]
    const projected = resize({
      nodes,
      spaces,
      collapsedIds: ['terminal'],
      edges,
      dx: edges.left ? 880 : -880,
      dy: edges.top ? 680 : -680,
    })

    expect(projected.nextSpaces[0].rect).toEqual({
      x: edges.left ? 500 : 0,
      y: edges.top ? 400 : 0,
      width: edges.left ? 400 : edges.right ? 224 : 900,
      height: edges.top ? 300 : edges.bottom ? 24 + getCollapsedNodeSize().height : 700,
    })
    expect(projected.nextNodePositionById.get(terminal.id)).toEqual(terminal.position)
    expect(terminal.data).toEqual(originalData)
  })

  it('keeps expanded windows contained when mixed with compact windows', () => {
    const nodes = [node('compact', 24, 24, 1600, 1000), node('expanded', 300, 200, 420, 280)]
    const spaces = [
      space(
        'root',
        { x: 0, y: 0, width: 1800, height: 1200 },
        nodes.map(n => n.id),
      ),
    ]
    const projected = resize({ nodes, spaces, collapsedIds: ['compact'], dx: -1600, dy: -1100 })

    expect(projected.nextSpaces[0].rect).toEqual({ x: 0, y: 0, width: 720, height: 480 })
    expect(projected.nextNodePositionById.get('expanded')).toEqual(nodes[1].position)
    expect(nodes.map(n => [n.data.width, n.data.height])).toEqual([
      [1600, 1000],
      [420, 280],
    ])
  })

  it('contains compact descendants by their child frame and visible node bounds', () => {
    const nodes = [node('compact', 124, 104, 900, 700)]
    const spaces = [
      space('root', { x: 0, y: 0, width: 1200, height: 900 }, []),
      space('child', { x: 100, y: 80, width: 392, height: 180 }, ['compact'], 'root'),
    ]
    const projected = resize({ nodes, spaces, collapsedIds: ['compact'], dx: -1100, dy: -850 })

    expect(projected.nextSpaces[0].rect).toEqual({ x: 0, y: 0, width: 492, height: 260 })
    expect(projected.nextSpaces[1]).toEqual(spaces[1])
    expect(nodes[0].data).toMatchObject({ width: 900, height: 700 })
  })

  it('resizes a child around compact content without changing its parent or runtime', () => {
    const nodes = [node('compact', 124, 104)]
    const spaces = [
      space('root', { x: 0, y: 0, width: 1200, height: 900 }, []),
      space('child', { x: 100, y: 80, width: 900, height: 700 }, ['compact'], 'root'),
    ]
    const projected = resize({
      nodes,
      spaces,
      collapsedIds: ['compact'],
      spaceId: 'child',
      dx: -850,
      dy: -660,
    })

    expect(projected.nextSpaces[0]).toEqual(spaces[0])
    expect(projected.nextSpaces[1].rect).toEqual({
      x: 100,
      y: 80,
      width: 224,
      height: 24 + getCollapsedNodeSize().height,
    })
    expect(nodes[0].data).toMatchObject({ width: 640, height: 480 })
  })

  it('uses compact peer bounds for push-away while preserving canonical dimensions', () => {
    const compact = node('compact', 600, 100, 1200, 1000)
    const nodes = [compact]
    const spaces = [space('root', { x: 1000, y: 0, width: 900, height: 700 }, [])]
    const projected = resize({ nodes, spaces, collapsedIds: ['compact'], dx: 100, dy: 0 })

    expect(projected.nextSpaces[0].rect).toEqual({ x: 1000, y: 0, width: 1000, height: 700 })
    expect(projected.nextNodePositionById.get('compact')).toEqual(compact.position)
    expect(getCollapsedNodeSize().width).toBeLessThan(1000 - compact.position.x)
    expect(compact.data).toMatchObject({ width: 1200, height: 1000 })
  })

  it('preserves the existing minimum when every owned node is expanded', () => {
    const nodes = [node('expanded', 24, 24, 220, 140)]
    const spaces = [space('root', { x: 0, y: 0, width: 900, height: 700 }, ['expanded'])]
    const projected = resize({ nodes, spaces, collapsedIds: [], dx: -880, dy: -680 })

    expect(projected.nextSpaces[0].rect).toEqual({ x: 0, y: 0, ...SPACE_MIN_SIZE })
  })
})
