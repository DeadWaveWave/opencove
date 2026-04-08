import React, { useRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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
        if (change.type === 'position' && change.position) {
          return currentNodes.map(node =>
            node.id === change.id
              ? {
                  ...node,
                  position: change.position,
                }
              : node,
          )
        }

        if (change.type === 'select' && typeof change.selected === 'boolean') {
          return currentNodes.map(node =>
            node.id === change.id
              ? {
                  ...node,
                  selected: change.selected,
                }
              : node,
          )
        }

        return currentNodes
      }, nodes)
    },
  }
})

describe('useWorkspaceCanvasApplyNodeChanges', () => {
  it('does not leak kill rejection on remove', async () => {
    const kill = vi.fn(async () => {
      throw new Error('boom')
    })

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill,
        },
      },
    })

    const { useWorkspaceCanvasApplyNodeChanges } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges')
    const { useWorkspaceCanvasNodeDragSession } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession')

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'node-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          sessionId: 'session-1',
          title: 't',
          width: 520,
          height: 360,
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
      const nodeDragSession = useWorkspaceCanvasNodeDragSession({
        workspaceId: 'workspace-remove',
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
          setNodes(next)
        },
        clearAgentLaunchToken: () => undefined,
        normalizePosition: (_nodeId, desired) => desired,
        applyPendingScrollbacks: next => next,
        isNodeDraggingRef: useRef(false),
        dragSelectedSpaceIdsRef,
        nodeDragSession,
      })

      return (
        <div>
          <div data-testid="count">{nodes.length}</div>
          <button type="button" onClick={() => apply([{ type: 'remove', id: 'node-1' } as never])}>
            Remove
          </button>
        </div>
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(kill).toHaveBeenCalledWith({ sessionId: 'session-1' })
    expect(screen.getByTestId('count')).toHaveTextContent('0')

    await Promise.resolve()
  })

  it('requests persist flush when dragging a node with selected spaces', async () => {
    const onRequestPersistFlush = vi.fn()
    const onSpacesChange = vi.fn()

    const { useWorkspaceCanvasApplyNodeChanges } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges')
    const { useWorkspaceCanvasNodeDragSession } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession')

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'outside-node',
        type: 'terminalNode',
        position: { x: 120, y: 220 },
        data: {
          sessionId: 'outside-session',
          title: 'outside',
          width: 460,
          height: 300,
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
        },
        draggable: true,
        selectable: true,
        selected: true,
      },
      {
        id: 'inside-node',
        type: 'terminalNode',
        position: { x: 840, y: 240 },
        data: {
          sessionId: 'inside-session',
          title: 'inside',
          width: 460,
          height: 300,
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
        },
        draggable: true,
        selectable: true,
      },
    ]

    const initialSpaces: WorkspaceSpaceState[] = [
      {
        id: 'selected-space',
        name: 'Selected Space',
        directoryPath: '/repo/demo',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['inside-node'],
        rect: { x: 800, y: 200, width: 540, height: 380 },
      },
    ]

    function Harness() {
      const [nodes, setNodes] = useState(initialNodes)
      const nodesRef = useRef(nodes)
      nodesRef.current = nodes
      const [, setSnapGuides] = useState(null)
      const magneticSnappingEnabledRef = useRef(false)
      const spacesRef = useRef<WorkspaceSpaceState[]>(initialSpaces)
      const selectedSpaceIdsRef = useRef<string[]>(['selected-space'])
      const dragSelectedSpaceIdsRef = useRef<string[] | null>(null)
      const nodeDragSession = useWorkspaceCanvasNodeDragSession({
        workspaceId: 'workspace-persist',
        spacesRef,
        selectedSpaceIdsRef,
        dragSelectedSpaceIdsRef,
        magneticSnappingEnabledRef,
        setSnapGuides,
        onSpacesChange,
        onRequestPersistFlush,
      })

      const apply = useWorkspaceCanvasApplyNodeChanges({
        nodesRef,
        onNodesChange: next => {
          setNodes(next)
        },
        clearAgentLaunchToken: () => undefined,
        normalizePosition: (_nodeId, desired) => desired,
        applyPendingScrollbacks: next => next,
        isNodeDraggingRef: useRef(false),
        dragSelectedSpaceIdsRef,
        nodeDragSession,
      })

      return (
        <button
          type="button"
          onClick={() => {
            apply([
              {
                type: 'position',
                id: 'outside-node',
                position: { x: 120, y: 400 },
                dragging: true,
              } as never,
            ])
            apply([
              {
                type: 'position',
                id: 'outside-node',
                position: { x: 120, y: 400 },
                dragging: false,
              } as never,
            ])
          }}
        >
          Drag
        </button>
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Drag' }))

    expect(onSpacesChange).toHaveBeenCalledWith([
      {
        id: 'selected-space',
        name: 'Selected Space',
        directoryPath: '/repo/demo',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['inside-node'],
        rect: { x: 800, y: 380, width: 540, height: 380 },
      },
    ])
    expect(onRequestPersistFlush).toHaveBeenCalledTimes(1)
  })

  it('keeps live guides during drag and commits snapping on release', async () => {
    const { useWorkspaceCanvasApplyNodeChanges } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges')
    const { useWorkspaceCanvasNodeDragSession } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession')

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'snap-a',
        type: 'terminalNode',
        position: { x: 100, y: 100 },
        data: {
          sessionId: 'snap-a-session',
          title: 'snap-a',
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
          note: { text: 'snap-a' },
        },
        draggable: true,
        selectable: true,
      },
      {
        id: 'snap-b',
        type: 'terminalNode',
        position: { x: 620, y: 420 },
        data: {
          sessionId: 'snap-b-session',
          title: 'snap-b',
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
          note: { text: 'snap-b' },
        },
        draggable: true,
        selectable: true,
      },
    ]

    function Harness() {
      const [nodes, setNodes] = useState(initialNodes)
      const nodesRef = useRef(nodes)
      nodesRef.current = nodes
      const [snapGuides, setSnapGuides] = useState<unknown[] | null>(null)
      const magneticSnappingEnabledRef = useRef(true)
      const spacesRef = useRef<WorkspaceSpaceState[]>([])
      const selectedSpaceIdsRef = useRef<string[]>([])
      const dragSelectedSpaceIdsRef = useRef<string[] | null>(null)
      const isNodeDraggingRef = useRef(false)
      const nodeDragSession = useWorkspaceCanvasNodeDragSession({
        workspaceId: 'workspace-snap',
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
          setNodes(next)
        },
        clearAgentLaunchToken: () => undefined,
        normalizePosition: (_nodeId, desired) => desired,
        applyPendingScrollbacks: next => next,
        isNodeDraggingRef,
        dragSelectedSpaceIdsRef,
        nodeDragSession,
      })

      const movedNode = nodes.find(node => node.id === 'snap-b')

      return (
        <div>
          <div data-testid="node-position">
            {movedNode?.position.x},{movedNode?.position.y}
          </div>
          <div data-testid="guide-count">{snapGuides?.length ?? 0}</div>
          <button
            type="button"
            onClick={() =>
              apply([
                {
                  type: 'position',
                  id: 'snap-b',
                  position: { x: 104, y: 430 },
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
                  id: 'snap-b',
                  position: { x: 104, y: 430 },
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
    expect(screen.getByTestId('node-position')).toHaveTextContent('104,430')
    expect(screen.getByTestId('guide-count')).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'Drop' }))
    expect(screen.getByTestId('node-position')).toHaveTextContent('100,432')
    expect(screen.getByTestId('guide-count')).toHaveTextContent('0')
  })
})
