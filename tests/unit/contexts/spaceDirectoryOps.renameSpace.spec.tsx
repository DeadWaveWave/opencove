import React, { useRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { useWorkspaceCanvasSpaceDirectoryOps } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDirectoryOps'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

describe('useWorkspaceCanvasSpaceDirectoryOps renameSpaceTo', () => {
  it('updates the space name when binding a worktree directory', () => {
    const onRequestPersistFlush = vi.fn()
    const closeNode = vi.fn(async () => undefined)
    const initialNodes: Node<TerminalNodeData>[] = []
    const initialSpaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Inbox',
        directoryPath: '/repo',
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: null,
      },
    ]

    function Harness() {
      const [nodes, setNodesState] = useState(initialNodes)
      const [spaces, setSpacesState] = useState(initialSpaces)
      const nodesRef = useRef(nodes)
      const spacesRef = useRef(spaces)

      nodesRef.current = nodes
      spacesRef.current = spaces

      const { updateSpaceDirectory } = useWorkspaceCanvasSpaceDirectoryOps({
        workspacePath: '/repo',
        spacesRef,
        nodesRef,
        setNodes: updater => {
          setNodesState(prevNodes => {
            const nextNodes = updater(prevNodes)
            nodesRef.current = nextNodes
            return nextNodes
          })
        },
        onSpacesChange: nextSpaces => {
          spacesRef.current = nextSpaces
          setSpacesState(nextSpaces)
        },
        onRequestPersistFlush,
        closeNode,
      })

      return (
        <div>
          <div data-testid="space-name">{spaces[0]?.name ?? 'missing'}</div>
          <div data-testid="space-directory">{spaces[0]?.directoryPath ?? 'missing'}</div>
          <button
            type="button"
            onClick={() => {
              updateSpaceDirectory('space-1', '/repo/.opencove/worktrees/feat-inbox', {
                renameSpaceTo: 'feat/inbox',
              })
            }}
          >
            Bind Worktree
          </button>
        </div>
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Bind Worktree' }))

    expect(screen.getByTestId('space-name')).toHaveTextContent('feat/inbox')
    expect(screen.getByTestId('space-directory')).toHaveTextContent(
      '/repo/.opencove/worktrees/feat-inbox',
    )
    expect(closeNode).not.toHaveBeenCalled()
    expect(onRequestPersistFlush).toHaveBeenCalledTimes(1)
  })
})
