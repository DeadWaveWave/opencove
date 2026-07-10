import React, { useRef, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

vi.mock('@xyflow/react', () => {
  return {
    applyNodeChanges: (
      changes: Array<Record<string, unknown>>,
      nodes: Array<Record<string, unknown>>,
    ) => {
      return changes.reduce<Array<Record<string, unknown>>>((currentNodes, change) => {
        if (change.type !== 'position' || !change.position) {
          return currentNodes
        }

        return currentNodes.map(node =>
          node.id === change.id
            ? {
                ...node,
                position: change.position,
              }
            : node,
        )
      }, nodes)
    },
  }
})

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.projectDropLayout',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.projectDropLayout')
      >()

    return {
      ...actual,
      projectWorkspaceNodeDropLayout: vi.fn(actual.projectWorkspaceNodeDropLayout),
      projectWorkspaceNodeLiveDropLayout: vi.fn(actual.projectWorkspaceNodeLiveDropLayout),
      projectWorkspaceNodePrimaryDropLayout: vi.fn(actual.projectWorkspaceNodePrimaryDropLayout),
    }
  },
)

describe('useWorkspaceCanvasApplyNodeChanges live and commit publishing', () => {
  it('publishes live drag positions without committing until release', async () => {
    const liveNodesChange = vi.fn()
    const committedNodesChange = vi.fn()

    const { useWorkspaceCanvasApplyNodeChanges } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges')
    const { useWorkspaceCanvasNodeDragSession } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession')
    const projectionModule =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.projectDropLayout')
    const liveProjection = vi.mocked(projectionModule.projectWorkspaceNodeLiveDropLayout)
    const finalProjection = vi.mocked(projectionModule.projectWorkspaceNodeDropLayout)
    liveProjection.mockClear()
    finalProjection.mockClear()

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'drag-node',
        type: 'terminalNode',
        position: { x: 10, y: 20 },
        data: {
          sessionId: 'drag-node-session',
          title: 'drag-node',
          width: 220,
          height: 140,
          kind: 'note',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: null,
          task: null,
          note: { text: 'drag-node' },
        },
        draggable: true,
        selectable: true,
      },
    ]

    function Harness() {
      const [nodes, setNodes] = useState(initialNodes)
      const nodesRef = useRef(nodes)
      nodesRef.current = nodes
      const [, setSnapGuides] = useState(null)
      const magneticSnappingEnabledRef = useRef(false)
      const spacesRef = useRef<WorkspaceSpaceState[]>([])
      const selectedSpaceIdsRef = useRef<string[]>([])
      const dragSelectedSpaceIdsRef = useRef<string[] | null>(null)
      const isNodeDraggingRef = useRef(false)
      const nodeDragSession = useWorkspaceCanvasNodeDragSession({
        workspaceId: 'workspace-live-commit',
        spacesRef,
        selectedSpaceIdsRef,
        dragSelectedSpaceIdsRef,
        magneticSnappingEnabledRef,
        setSnapGuides,
        onSpacesChange: () => undefined,
      })

      const apply = useWorkspaceCanvasApplyNodeChanges({
        nodesRef,
        onNodesChange: next => {
          liveNodesChange(next)
          setNodes(next)
        },
        onNodesCommit: next => {
          committedNodesChange(next)
          setNodes(next)
        },
        clearAgentLaunchToken: () => undefined,
        normalizePosition: (_nodeId, desired) => desired,
        applyPendingScrollbacks: next => next,
        isNodeDraggingRef,
        dragSelectedSpaceIdsRef,
        nodeDragSession,
      })

      const movedNode = nodes.find(node => node.id === 'drag-node')

      return (
        <div>
          <div data-testid="node-position">
            {movedNode?.position.x},{movedNode?.position.y}
          </div>
          <button
            type="button"
            onClick={() =>
              apply([
                {
                  type: 'position',
                  id: 'drag-node',
                  position: { x: 40, y: 50 },
                  dragging: true,
                } as never,
              ])
            }
          >
            Drag
          </button>
          <button
            type="button"
            onClick={() =>
              apply([
                {
                  type: 'position',
                  id: 'drag-node',
                  position: { x: 70, y: 80 },
                  dragging: false,
                } as never,
              ])
            }
          >
            Drop
          </button>
        </div>
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Drag' }))

    await waitFor(() => {
      expect(screen.getByTestId('node-position')).toHaveTextContent('40,50')
    })
    expect(liveNodesChange).toHaveBeenCalledTimes(1)
    expect(committedNodesChange).not.toHaveBeenCalled()
    expect(liveProjection).toHaveBeenCalledTimes(1)
    expect(finalProjection).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Drop' }))

    await waitFor(() => {
      expect(screen.getByTestId('node-position')).toHaveTextContent('70,80')
    })
    expect(committedNodesChange).toHaveBeenCalledTimes(1)
    expect(finalProjection).toHaveBeenCalledTimes(1)
  })

  it('retains a derived Space preview on primary-only frames and never commits it', async () => {
    const onSpacesChange = vi.fn()
    const onRequestPersistFlush = vi.fn()
    const { useWorkspaceCanvasNodeDragSession } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession')

    const createNode = ({
      id,
      position,
      text,
    }: {
      id: string
      position: { x: number; y: number }
      text: string
    }): Node<TerminalNodeData> => ({
      id,
      type: 'terminalNode',
      position,
      data: {
        sessionId: `${id}-session`,
        title: id,
        width: 460,
        height: 300,
        kind: 'note',
        status: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: null,
        agent: null,
        task: null,
        note: { text },
      },
    })
    const nodes = [
      createNode({ id: 'static', position: { x: 24, y: 24 }, text: 'static' }),
      createNode({ id: 'drag', position: { x: 24, y: 480 }, text: 'drag' }),
    ]
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space',
        name: 'space',
        directoryPath: '/tmp/space',
        targetMountId: null,
        nodeIds: ['static'],
        rect: { x: 0, y: 0, width: 520, height: 360 },
      },
    ]

    function Harness() {
      const spacesRef = useRef(spaces)
      const selectedSpaceIdsRef = useRef<string[]>([])
      const dragSelectedSpaceIdsRef = useRef<string[] | null>(null)
      const magneticSnappingEnabledRef = useRef(false)
      const [, setSnapGuides] = useState(null)
      const session = useWorkspaceCanvasNodeDragSession({
        workspaceId: 'workspace-space-preview-retention',
        spacesRef,
        selectedSpaceIdsRef,
        dragSelectedSpaceIdsRef,
        magneticSnappingEnabledRef,
        setSnapGuides,
        onSpacesChange,
        onRequestPersistFlush,
      })
      const project = () =>
        session.projectNodeDrag({
          currentNodes: nodes,
          draggedNodeIds: ['drag'],
          desiredDraggedPositionById: new Map([['drag', { x: 24, y: 24 }]]),
          dropFlowPoint: { x: 260, y: 180 },
          anchorNodeId: 'drag',
        })

      return (
        <div>
          <div data-testid="preview-height">
            {session.nodeSpaceFramePreview?.get('space')?.height ?? 'none'}
          </div>
          <button
            type="button"
            onClick={() => {
              session.beginNodeDragSession(nodes)
              project()
            }}
          >
            Secondary
          </button>
          <button type="button" onClick={project}>
            Primary
          </button>
          <button type="button" onClick={session.endNodeDragSession}>
            End
          </button>
        </div>
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Secondary' }))
    await waitFor(() => {
      expect(Number(screen.getByTestId('preview-height').textContent)).toBeGreaterThan(360)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Primary' }))
    await waitFor(() => {
      expect(Number(screen.getByTestId('preview-height').textContent)).toBeGreaterThan(360)
    })
    expect(onSpacesChange).not.toHaveBeenCalled()
    expect(onRequestPersistFlush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'End' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-height')).toHaveTextContent('none')
    })
    expect(onSpacesChange).not.toHaveBeenCalled()
    expect(onRequestPersistFlush).not.toHaveBeenCalled()
  })
})
