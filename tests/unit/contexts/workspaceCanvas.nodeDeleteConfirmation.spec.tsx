import React, { useRef, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasNodeDeleteConfirmation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDeleteConfirmation'
import { useCanvasUi } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import {
  CANVAS_STORE_TEST_WORKSPACE_ID,
  CanvasStoreTestProvider,
} from '../../support/canvasStoreTestHarness'
import { seedWorkspaceCanvasStore } from '../../support/workspaceCanvasStoreHarness'

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

function Harness({ closeNode }: { closeNode: (nodeId: string) => Promise<void> }) {
  const requestNodeDeleteRef = useRef<(nodeIds: string[]) => void>(() => undefined)
  const { confirmNodeDelete, requestNodeClose } = useWorkspaceCanvasNodeDeleteConfirmation({
    closeNode,
    requestNodeDeleteRef,
  })
  const nodeDeleteConfirmation = useCanvasUi(ui => ui.nodeDeleteConfirmation)

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

// The confirmation reads the document, so the nodes and the Spaces are seeded into the store
// before the hook first renders.
function SeededHarness({
  nodes,
  spaces,
  closeNode,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  closeNode: (nodeId: string) => Promise<void>
}) {
  useState(() => {
    seedWorkspaceCanvasStore({ workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID, nodes, spaces })
    return null
  })
  return <Harness closeNode={closeNode} />
}

describe('workspace canvas node delete confirmation', () => {
  it('closes the last node in a space without prompting', async () => {
    const closeNode = vi.fn(async () => undefined)

    render(
      <CanvasStoreTestProvider>
        <SeededHarness
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
        />
      </CanvasStoreTestProvider>,
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
      <CanvasStoreTestProvider>
        <SeededHarness
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
        />
      </CanvasStoreTestProvider>,
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
      <CanvasStoreTestProvider>
        <SeededHarness
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
        />
      </CanvasStoreTestProvider>,
    )

    fireEvent.click(screen.getByTestId('request-delete'))

    await waitFor(() => {
      expect(screen.getByTestId('confirmation-state').textContent).toContain('"Pair Space"')
    })
    expect(closeNode).not.toHaveBeenCalled()
  })

  it('closes the confirmation after the delete is confirmed', async () => {
    const closeNode = vi.fn(async () => undefined)

    render(
      <CanvasStoreTestProvider>
        <SeededHarness
          closeNode={closeNode}
          nodes={[createNoteNode('note-1', 'First note'), createNoteNode('note-2', 'Second note')]}
          spaces={[]}
        />
      </CanvasStoreTestProvider>,
    )

    fireEvent.click(screen.getByTestId('request-delete'))
    await waitFor(() => {
      expect(screen.getByTestId('confirmation-state').textContent).not.toBe('null')
    })

    fireEvent.click(screen.getByTestId('confirm-delete'))

    await waitFor(() => {
      expect(closeNode).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.getByTestId('confirmation-state').textContent).toBe('null')
    })
  })
})
