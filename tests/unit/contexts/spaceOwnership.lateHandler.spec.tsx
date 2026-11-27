import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasSpaceOwnership } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership'
import {
  readWorkspaceDocument,
  replaceWorkspaceNodes,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { createSpace } from '../../support/canvasSelectionFixtures'
import { pixelNode } from './workspacePixelLayer.fixtures'

// The drop hooks take the node writer from the canvas store provider (S7, PR 2). A handler made
// while workspace A was shown writes A's document, also when it runs after B is shown.

const REPO = '/tmp/repo'
const OTHER = '/tmp/other'
const NODE_IN_C = { x: 800, y: 100 }
const DROP_INTO_C = { x: 950, y: 200 }

function taskDoing(id: string, x: number, y: number): Node<TerminalNodeData> {
  const node = {
    ...pixelNode({
      kind: 'task',
      sessionId: '',
      task: { requirement: 'r', status: 'doing', linkedAgentNodeId: null } as never,
    }),
    id,
    position: { x, y },
  }
  return { ...node, initialWidth: node.data.width, initialHeight: node.data.height }
}

describe('a node drop through a handler of a workspace that is no longer shown', () => {
  it('reverts a refused drop in A when a handler of A runs after B is shown', () => {
    const t1 = taskDoing('t1', 50, 60)
    createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      nodes: [t1],
      spaces: [
        createSpace('space-a', { x: 0, y: 0, width: 600, height: 400 }, ['t1']),
        {
          ...createSpace('space-c', { x: 700, y: 0, width: 500, height: 400 }, []),
          directoryPath: OTHER,
        },
      ],
    })
    const stateA = useAppStore.getState().workspaces[0]
    useAppStore.setState({ workspaces: [stateA, { ...stateA, id: 'workspace-b' }] })
    let current = 'workspace-a'
    const view = renderInCanvasDocument(
      () => {
        const workspaceId = current
        const nodesOf = () => readWorkspaceDocument(workspaceId)?.nodes ?? []
        return useWorkspaceCanvasSpaceOwnership({
          workspaceId,
          workspacePath: REPO,
          reactFlow: {
            screenToFlowPosition: (point: { x: number; y: number }) => point,
            flowToScreenPosition: (point: { x: number; y: number }) => point,
            getNodes: nodesOf,
            getNode: (id: string) => nodesOf().find(node => node.id === id),
          } as never,
          nodeDragSession: {
            captureDragStartSpaceSelection: () => undefined,
            getDragStartSpaceSelection: () => null,
            clearDragStartSpaceSelection: () => undefined,
          },
          exclusiveNodeDragAnchorIdRef: { current: null },
          updateCanvasDocument: vi.fn(),
          onShowMessage: vi.fn(),
          hideWorktreeMismatchDropWarning: true,
        })
      },
      { workspaceId: () => current },
    )
    const handlersOfA = view.result.current
    act(() =>
      handlersOfA.handleNodeDragStart(
        { clientX: 10, clientY: 10, shiftKey: true } as React.MouseEvent,
        t1,
        [t1],
      ),
    )
    act(() => {
      replaceWorkspaceNodes('workspace-a', [{ ...t1, position: NODE_IN_C }])
      replaceWorkspaceNodes('workspace-b', [{ ...t1, position: NODE_IN_C }])
    })
    current = 'workspace-b'
    view.rerender()
    const nodesOfB = readWorkspaceDocument('workspace-b')!.nodes
    const dropped = readWorkspaceDocument('workspace-a')!.nodes[0]

    act(() =>
      handlersOfA.handleNodeDragStop(
        { clientX: DROP_INTO_C.x, clientY: DROP_INTO_C.y, shiftKey: true } as React.MouseEvent,
        dropped,
        [dropped],
      ),
    )

    expect(readWorkspaceDocument('workspace-a')!.nodes[0].position).toEqual({ x: 50, y: 60 })
    expect(readWorkspaceDocument('workspace-b')!.nodes).toBe(nodesOfB)
  })
})
