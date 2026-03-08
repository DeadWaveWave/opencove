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

    Object.defineProperty(window, 'coveApi', {
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
      const spacesRef = useRef<WorkspaceSpaceState[]>([])
      const selectedSpaceIdsRef = useRef<string[]>([])

      const apply = useWorkspaceCanvasApplyNodeChanges({
        nodesRef,
        onNodesChange: next => {
          setNodes(next)
        },
        clearAgentLaunchToken: () => undefined,
        normalizePosition: (_nodeId, desired) => desired,
        applyPendingScrollbacks: next => next,
        isNodeDraggingRef: useRef(false),
        selectionDraftRef: useRef(null),
        spacesRef,
        selectedSpaceIdsRef,
        onSpacesChange: () => undefined,
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
        nodeIds: ['inside-node'],
        rect: { x: 800, y: 200, width: 540, height: 380 },
      },
    ]

    function Harness() {
      const [nodes, setNodes] = useState(initialNodes)
      const nodesRef = useRef(nodes)
      nodesRef.current = nodes
      const spacesRef = useRef<WorkspaceSpaceState[]>(initialSpaces)
      const selectedSpaceIdsRef = useRef<string[]>(['selected-space'])

      const apply = useWorkspaceCanvasApplyNodeChanges({
        nodesRef,
        onNodesChange: next => {
          setNodes(next)
        },
        clearAgentLaunchToken: () => undefined,
        normalizePosition: (_nodeId, desired) => desired,
        applyPendingScrollbacks: next => next,
        isNodeDraggingRef: useRef(false),
        selectionDraftRef: useRef(null),
        spacesRef,
        selectedSpaceIdsRef,
        onSpacesChange,
        onRequestPersistFlush,
      })

      return (
        <button
          type="button"
          onClick={() =>
            apply([
              {
                type: 'position',
                id: 'outside-node',
                position: { x: 120, y: 400 },
                dragging: false,
              } as never,
            ])
          }
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
        nodeIds: ['inside-node'],
        rect: { x: 800, y: 380, width: 540, height: 380 },
      },
    ])
    expect(onRequestPersistFlush).toHaveBeenCalledTimes(1)
  })
})
