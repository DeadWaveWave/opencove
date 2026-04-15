import React, { useRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasNodeDeleteConfirmation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDeleteConfirmation'

function createNoteNode(id: string, title: string): Node<TerminalNodeData> {
  return {
    id,
    type: 'noteNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: '',
      title,
      width: 320,
      height: 200,
      kind: 'note',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: null,
      expectedDirectory: null,
      agent: null,
      task: null,
      note: {
        text: title,
      },
    },
    draggable: true,
    selectable: true,
  }
}

function Harness({
  nodes,
  spaces,
  closeNode,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  closeNode: (nodeId: string) => Promise<void>
}) {
  const nodesRef = useRef(nodes)
  const spacesRef = useRef(spaces)
  const requestNodeDeleteRef = useRef<(nodeIds: string[]) => void>(() => undefined)
  const { nodeDeleteConfirmation, confirmNodeDelete, requestNodeClose } =
    useWorkspaceCanvasNodeDeleteConfirmation({
      nodesRef,
      spacesRef,
      closeNode,
      requestNodeDeleteRef,
    })

  return (
    <>
      <button
        type="button"
        data-testid="request-close"
        onClick={() => {
          void requestNodeClose('note-1')
        }}
      >
        close
      </button>
      <button
        type="button"
        data-testid="request-delete"
        onClick={() => {
          requestNodeDeleteRef.current(['note-1', 'note-2'])
        }}
      >
        delete
      </button>
      <button
        type="button"
        data-testid="confirm-delete"
        onClick={() => {
          void confirmNodeDelete()
        }}
      >
        confirm
      </button>
      <pre data-testid="confirmation-state">{JSON.stringify(nodeDeleteConfirmation)}</pre>
    </>
  )
}

describe('workspace canvas node delete confirmation', () => {
  it('closes the last node in a space without prompting', async () => {
    const closeNode = vi.fn(async () => undefined)

    render(
      <Harness
        closeNode={closeNode}
        nodes={[createNoteNode('note-1', 'Lonely note')]}
        spaces={[
          {
            id: 'space-1',
            name: 'Solo Space',
            directoryPath: '/tmp/solo',
            targetMountId: null,
            labelColor: null,
            nodeIds: ['note-1'],
            rect: null,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByTestId('request-close'))

    await waitFor(() => {
      expect(closeNode).toHaveBeenCalledWith('note-1')
    })
    expect(screen.getByTestId('confirmation-state').textContent).toBe('null')
  })

  it('keeps direct close immediate when the space still has other nodes', async () => {
    const closeNode = vi.fn(async () => undefined)

    render(
      <Harness
        closeNode={closeNode}
        nodes={[createNoteNode('note-1', 'First note'), createNoteNode('note-2', 'Second note')]}
        spaces={[
          {
            id: 'space-1',
            name: 'Pair Space',
            directoryPath: '/tmp/pair',
            targetMountId: null,
            labelColor: null,
            nodeIds: ['note-1', 'note-2'],
            rect: null,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByTestId('request-close'))

    await waitFor(() => {
      expect(closeNode).toHaveBeenCalledWith('note-1')
    })
    expect(screen.getByTestId('confirmation-state').textContent).toBe('null')
  })

  it('annotates multi-node delete when it would empty a space', async () => {
    const closeNode = vi.fn(async () => undefined)

    render(
      <Harness
        closeNode={closeNode}
        nodes={[createNoteNode('note-1', 'First note'), createNoteNode('note-2', 'Second note')]}
        spaces={[
          {
            id: 'space-1',
            name: 'Pair Space',
            directoryPath: '/tmp/pair',
            targetMountId: null,
            labelColor: null,
            nodeIds: ['note-1', 'note-2'],
            rect: null,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByTestId('request-delete'))

    await waitFor(() => {
      expect(screen.getByTestId('confirmation-state').textContent).toContain('"Pair Space"')
    })
    expect(closeNode).not.toHaveBeenCalled()
  })
})
