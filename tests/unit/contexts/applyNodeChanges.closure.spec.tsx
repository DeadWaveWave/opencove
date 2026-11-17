import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasApplyNodeChanges } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges'
import { subscribeWorkspaceNodesClosed } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeClosureEvents'
import type { WorkspaceCanvasNodeDragSession } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import { pixelNode } from './workspacePixelLayer.fixtures'

vi.mock('../../../src/contexts/workspace/presentation/renderer/utils/nodeRuntimeCleanup', () => ({
  cleanupNodeRuntimeArtifacts: vi.fn(),
}))

function dragSession(): WorkspaceCanvasNodeDragSession {
  return {
    nodeDragPointerAnchorRef: { current: null },
    nodeSpaceFramePreview: null,
    dragBaselinePositionByIdRef: { current: null },
    dragBaselineSpaceRectByIdRef: { current: null },
    beginNodeDragSession: vi.fn(),
    endNodeDragSession: vi.fn(),
    clearNodeDragProjection: vi.fn(),
    applyPendingReleaseProjection: nodes => nodes,
    projectNodeDrag: ({ currentNodes }) => ({
      nextNodes: currentNodes,
      nextDraggedNodePositionById: new Map(),
      nextSpaceFramePreview: null,
    }),
  }
}

describe('ReactFlow removal closure notifications', () => {
  let unsubscribe: () => void = () => undefined
  afterEach(() => {
    unsubscribe()
    cleanup()
    vi.restoreAllMocks()
  })

  it.each(['commit', 'change'] as const)(
    'publishes one actual removal batch after the %s owner returns',
    route => {
      const order: string[] = []
      const kill = vi.fn(() => {
        order.push('kill')
        return new Promise<void>(() => undefined)
      })
      Object.defineProperty(window, 'opencoveApi', { configurable: true, value: { pty: { kill } } })
      const nodesRef = {
        current: [pixelNode(), { ...pixelNode({ kind: 'note', sessionId: '' }), id: 'note-2' }],
      }
      const publish = vi.fn(() => {
        order.push('commit')
      })
      const view = renderHook(() =>
        useWorkspaceCanvasApplyNodeChanges({
          nodesRef,
          onNodesChange: publish,
          onNodesCommit: route === 'commit' ? publish : undefined,
          clearAgentLaunchToken: vi.fn(),
          normalizePosition: (_id, desired) => desired,
          applyPendingScrollbacks: nodes => nodes,
          isNodeDraggingRef: { current: false },
          nodeDragSession: dragSession(),
        }),
      )
      const closed = vi.fn((ids: string[]) => {
        expect(ids).toEqual(['terminal-1', 'note-2'])
        expect(nodesRef.current).toEqual([])
        order.push('closed')
      })
      unsubscribe = subscribeWorkspaceNodesClosed(closed)
      act(() =>
        view.result.current([
          { type: 'remove', id: 'terminal-1' },
          { type: 'remove', id: 'note-2' },
          { type: 'remove', id: 'terminal-1' },
          { type: 'remove', id: 'missing' },
        ]),
      )
      expect(order).toEqual(['kill', 'commit', 'closed'])
      expect(closed).toHaveBeenCalledTimes(1)
      act(() => view.result.current([{ type: 'remove', id: 'terminal-1' }]))
      act(() => view.result.current([]))
      expect(closed).toHaveBeenCalledTimes(1)
      expect(kill).toHaveBeenCalledTimes(1)
    },
  )
})
