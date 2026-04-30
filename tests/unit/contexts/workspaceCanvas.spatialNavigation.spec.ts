import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { resolveSpatialNavigationTargetId } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/spatialNavigation'
import {
  resolveNodeNavigationTargetId,
  resolveSpaceNavigationTargetId,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts.helpers'

function createTestNode(id: string, x: number, y: number): Node<TerminalNodeData> {
  return {
    id,
    type: 'noteNode',
    position: { x, y },
    data: {
      // Only width/height are used by the spatial navigation helpers.
      width: 100,
      height: 100,
    } as unknown as TerminalNodeData,
  } as unknown as Node<TerminalNodeData>
}

describe('workspace canvas spatial navigation', () => {
  it('prefers beam candidates for horizontal navigation (beam-first)', () => {
    const source = { left: 0, top: 0, right: 100, bottom: 100 }

    const targetId = resolveSpatialNavigationTargetId({
      direction: 'right',
      source,
      candidates: [
        {
          id: 'in-beam',
          rect: { left: 120, top: 20, right: 220, bottom: 80 },
        },
        {
          id: 'closer-but-outside-beam',
          rect: { left: 110, top: 200, right: 210, bottom: 260 },
        },
      ],
    })

    expect(targetId).toBe('in-beam')
  })

  it('does not always prefer beam candidates for vertical navigation when another target is completely closer', () => {
    const source = { left: 0, top: 0, right: 100, bottom: 100 }

    const targetId = resolveSpatialNavigationTargetId({
      direction: 'down',
      source,
      candidates: [
        {
          id: 'in-beam-but-far',
          rect: { left: 20, top: 300, right: 80, bottom: 400 },
        },
        {
          id: 'out-of-beam-but-much-closer',
          rect: { left: 150, top: 120, right: 250, bottom: 220 },
        },
      ],
    })

    expect(targetId).toBe('out-of-beam-but-much-closer')
  })

  it('returns null when there is no candidate in the requested direction', () => {
    const source = { left: 0, top: 0, right: 100, bottom: 100 }

    expect(
      resolveSpatialNavigationTargetId({
        direction: 'left',
        source,
        candidates: [{ id: 'right-only', rect: { left: 120, top: 0, right: 220, bottom: 80 } }],
      }),
    ).toBeNull()
  })

  it('resolves node navigation targets within the active space when there is no selected node', () => {
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-a',
        name: 'A',
        directoryPath: '/tmp/a',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['a-left', 'a-right'],
        rect: { x: 0, y: 0, width: 300, height: 200 },
      },
    ]

    const nodes: Array<Node<TerminalNodeData>> = [
      createTestNode('a-left', 10, 50),
      createTestNode('a-right', 220, 50),
    ]

    const result = resolveNodeNavigationTargetId({
      direction: 'right',
      sourceNodeId: null,
      activeSpaceId: 'space-a',
      nodes,
      spaces,
      viewportRect: { left: 0, top: 0, right: 300, bottom: 200 },
    })

    expect(result?.targetNodeId).toBe('a-right')
    expect(result?.containerSpaceId).toBe('space-a')
  })

  it('resolves space navigation targets relative to the active space', () => {
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-left',
        name: 'Left',
        directoryPath: '/tmp/left',
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: { x: 0, y: 0, width: 200, height: 200 },
      },
      {
        id: 'space-right',
        name: 'Right',
        directoryPath: '/tmp/right',
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: { x: 400, y: 0, width: 200, height: 200 },
      },
    ]

    const target = resolveSpaceNavigationTargetId({
      direction: 'right',
      sourceNodeId: null,
      activeSpaceId: 'space-left',
      spaces,
      viewportRect: { left: 0, top: 0, right: 600, bottom: 300 },
    })

    expect(target).toBe('space-right')
  })
})
