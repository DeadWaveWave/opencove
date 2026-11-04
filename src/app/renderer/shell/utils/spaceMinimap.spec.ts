import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type TerminalNodeData,
  type WorkspaceNodeKind,
  type WorkspaceSpaceState,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { buildSpaceMinimap } from './spaceMinimap'

function node(
  id: string,
  kind: WorkspaceNodeKind,
  rect: { x: number; y: number; width: number; height: number },
  status: TerminalNodeData['status'] = null,
): Node<TerminalNodeData> {
  return {
    id,
    position: { x: rect.x, y: rect.y },
    width: rect.width,
    height: rect.height,
    data: { kind, title: id, status, width: rect.width, height: rect.height, agent: null },
  } as Node<TerminalNodeData>
}

function space(
  id: string,
  nodeIds: string[],
  rect: WorkspaceSpaceState['rect'],
  parentSpaceId?: string,
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/tmp/project',
    targetMountId: null,
    labelColor: null,
    nodeIds,
    rect,
    parentSpaceId,
  }
}

function workspace(nodes: Node<TerminalNodeData>[], spaces: WorkspaceSpaceState[]): WorkspaceState {
  return {
    id: 'project',
    name: 'project',
    path: '/tmp/project',
    worktreesRoot: '',
    nodes,
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces,
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

describe('buildSpaceMinimap', () => {
  it('places windows in the Space frame with their family and live status', () => {
    const root = space('build', ['agent', 'term'], { x: 100, y: 100, width: 1000, height: 500 })
    const model = buildSpaceMinimap(
      workspace(
        [
          node('agent', 'agent', { x: 100, y: 100, width: 500, height: 250 }, 'waiting'),
          node('term', 'terminal', { x: 600, y: 350, width: 500, height: 250 }),
          node('elsewhere', 'note', { x: 0, y: 0, width: 10, height: 10 }),
        ],
        [root],
      ),
      root,
    )

    expect(model.aspectRatio).toBe(2)
    expect(model.windows).toEqual([
      expect.objectContaining({
        nodeId: 'agent',
        family: 'ai',
        status: 'waiting',
        left: 0,
        top: 0,
        width: 0.5,
        height: 0.5,
      }),
      expect.objectContaining({
        nodeId: 'term',
        family: 'shell',
        status: null,
        left: 0.5,
        top: 0.5,
        width: 0.5,
        height: 0.5,
      }),
    ])
    expect(model.waitingCount).toBe(1)
    expect(model.workingCount).toBe(0)
  })

  it('includes windows of child Spaces and clamps windows that overhang the frame', () => {
    const root = space('root', [], { x: 0, y: 0, width: 400, height: 300 })
    const child = space('child', ['task'], null, 'root')
    const model = buildSpaceMinimap(
      workspace(
        [node('task', 'task', { x: 300, y: 200, width: 200, height: 200 }, null)],
        [root, child],
      ),
      root,
    )
    expect(model.windows).toEqual([
      expect.objectContaining({
        nodeId: 'task',
        family: 'plan',
        left: 0.75,
        width: 0.25,
        height: expect.closeTo(1 / 3, 6),
      }),
    ])
  })

  it('frames the windows themselves when the Space has no rect and clamps the shape', () => {
    const root = space('tall', ['a'], null)
    const model = buildSpaceMinimap(
      workspace([node('a', 'agent', { x: 0, y: 0, width: 100, height: 900 }, 'running')], [root]),
      root,
    )
    expect(model.aspectRatio).toBe(1.05)
    expect(model.workingCount).toBe(1)
    expect(model.windows[0]).toMatchObject({
      status: 'working',
      // 40px of fit padding on each side of a 100px window.
      left: expect.closeTo(40 / 180, 6),
    })
  })

  it('is empty for an empty Space', () => {
    const root = space('empty', [], null)
    expect(buildSpaceMinimap(workspace([], [root]), root).windows).toEqual([])
  })
})
