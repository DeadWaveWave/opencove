import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { SpaceWorktreeWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceWorktreeWindow'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

function createNodes(): Node<TerminalNodeData>[] {
  return []
}

function createSpaces(directoryPath = '/repo'): WorkspaceSpaceState[] {
  return [
    {
      id: 'space-1',
      name: 'Space 1',
      directoryPath,
      nodeIds: [],
      rect: null,
    },
  ]
}

describe('SpaceWorktreeWindow create flow', () => {
  it('calls onClose after creating and binding a worktree', async () => {
    const listBranches = vi.fn(async () => ({
      current: 'main',
      branches: ['main', 'feature/demo'],
    }))
    const listWorktrees = vi.fn(async () => ({
      worktrees: [{ path: '/repo', head: 'abc', branch: 'main' }],
    }))
    const create = vi.fn(async () => ({
      worktree: {
        path: '/repo/.cove/worktrees/space-demo--1a2b3c4d',
        head: null,
        branch: 'space/demo',
      },
    }))
    const onClose = vi.fn()

    Object.defineProperty(window, 'coveApi', {
      configurable: true,
      writable: true,
      value: {
        worktree: {
          listBranches,
          listWorktrees,
          suggestNames: vi.fn(async () => ({
            branchName: 'space/demo',
            worktreeName: 'demo',
            provider: 'codex',
            effectiveModel: 'gpt-5.2-codex',
          })),
          create,
          remove: vi.fn(async () => ({
            deletedBranchName: null,
            branchDeleteError: null,
          })),
        },
      },
    })

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        spaces={createSpaces('/repo')}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".cove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onUpdateSpaceDirectory={() => undefined}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    await waitFor(() => {
      expect(listBranches).toHaveBeenCalledTimes(1)
      expect(listWorktrees).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(await screen.findByTestId('space-worktree-open-create'))
    expect(await screen.findByTestId('space-worktree-create-view')).toBeVisible()
    expect(screen.queryByTestId('space-worktree-name')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('space-worktree-branch-name'), {
      target: { value: 'space/demo' },
    })
    fireEvent.click(screen.getByTestId('space-worktree-create'))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        repoPath: '/repo',
        worktreesRoot: '/repo/.cove/worktrees',
        branchMode: { kind: 'new', name: 'space/demo', startPoint: 'main' },
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
