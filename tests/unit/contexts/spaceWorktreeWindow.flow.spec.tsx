import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { SpaceWorktreeWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceWorktreeWindow'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

function createNodes(): Node<TerminalNodeData>[] {
  return []
}

function createSpaces(directoryPath = '/repo/.cove/worktrees/space-1'): WorkspaceSpaceState[] {
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

function installWorktreeApi(overrides?: Record<string, unknown>): {
  create: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
} {
  const create = vi.fn(async () => ({
    worktree: {
      path: '/repo/.cove/worktrees/space-demo--1a2b3c4d',
      head: null,
      branch: 'space/demo',
    },
  }))
  const remove = vi.fn(async () => ({
    deletedBranchName: null,
    branchDeleteError: null,
  }))

  const worktreeApi = {
    listBranches: vi.fn(async () => ({
      current: 'main',
      branches: ['main', 'feature/demo'],
    })),
    listWorktrees: vi.fn(async () => ({
      worktrees: [
        { path: '/repo', head: 'abc', branch: 'main' },
        {
          path: '/repo/.cove/worktrees/space-1',
          head: 'def',
          branch: 'feature/demo',
        },
      ],
    })),
    suggestNames: vi.fn(async () => ({
      branchName: 'space/demo',
      worktreeName: 'demo',
      provider: 'codex',
      effectiveModel: 'gpt-5.2-codex',
    })),
    create,
    remove,
    ...overrides,
  }

  Object.defineProperty(window, 'coveApi', {
    configurable: true,
    writable: true,
    value: {
      worktree: worktreeApi,
    },
  })

  return {
    create: worktreeApi.create as ReturnType<typeof vi.fn>,
    remove: worktreeApi.remove as ReturnType<typeof vi.fn>,
  }
}

describe('SpaceWorktreeWindow flow', () => {
  afterEach(() => {
    delete (window as unknown as { coveApi?: unknown }).coveApi
  })

  it('shows archive action for managed worktrees and create action for root spaces', async () => {
    installWorktreeApi()

    const { rerender } = render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".cove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={() => undefined}
        onUpdateSpaceDirectory={() => undefined}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    expect(await screen.findByTestId('space-worktree-open-archive')).toBeVisible()
    expect(screen.queryByTestId('space-worktree-open-create')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('space-worktree-open-archive'))
    expect(screen.getByTestId('space-worktree-archive-view')).toBeVisible()

    fireEvent.click(screen.getByTestId('space-worktree-back-home'))
    expect(screen.getByTestId('space-worktree-home-view')).toBeVisible()

    rerender(
      <SpaceWorktreeWindow
        spaceId="space-1"
        spaces={createSpaces('/repo')}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".cove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={() => undefined}
        onUpdateSpaceDirectory={() => undefined}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    expect(await screen.findByTestId('space-worktree-open-create')).toBeVisible()
    expect(screen.queryByTestId('space-worktree-open-archive')).not.toBeInTheDocument()
  })

  it('archives a managed worktree and can delete its branch', async () => {
    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()
    const { remove } = installWorktreeApi({
      remove: vi.fn(async () => ({
        deletedBranchName: 'feature/demo',
        branchDeleteError: null,
      })),
    })

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".cove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    fireEvent.click(await screen.findByTestId('space-worktree-open-archive'))
    fireEvent.click(screen.getByTestId('space-worktree-archive-delete-branch'))
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith({
        repoPath: '/repo',
        worktreePath: '/repo/.cove/worktrees/space-1',
        force: false,
        deleteBranch: true,
      })
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith('space-1', '/repo', undefined)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('can archive the space itself while removing its managed worktree', async () => {
    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()
    const { remove } = installWorktreeApi()

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".cove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    fireEvent.click(await screen.findByTestId('space-worktree-open-archive'))
    fireEvent.click(screen.getByTestId('space-worktree-archive-space'))
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith({
        repoPath: '/repo',
        worktreePath: '/repo/.cove/worktrees/space-1',
        force: false,
        deleteBranch: false,
      })
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith('space-1', '/repo', {
        archiveSpace: true,
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('allows mark-mismatch when create is blocked by active windows', async () => {
    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()
    const closeNodesById = vi.fn(async () => undefined)
    installWorktreeApi({
      listWorktrees: vi.fn(async () => ({
        worktrees: [{ path: '/repo', head: 'abc', branch: 'main' }],
      })),
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
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: ['agent-1'], terminalNodeIds: ['terminal-1'] })}
        closeNodesById={closeNodesById}
      />,
    )

    fireEvent.click(await screen.findByTestId('space-worktree-open-create'))
    fireEvent.change(screen.getByTestId('space-worktree-branch-name'), {
      target: { value: 'space/demo' },
    })
    fireEvent.click(screen.getByTestId('space-worktree-create'))

    expect(await screen.findByTestId('space-worktree-guard')).toBeVisible()
    expect(screen.getByTestId('space-worktree-guard-mark-mismatch')).toBeVisible()

    fireEvent.click(screen.getByTestId('space-worktree-guard-mark-mismatch'))

    await waitFor(() => {
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith(
        'space-1',
        '/repo/.cove/worktrees/space-demo--1a2b3c4d',
        { markNodeDirectoryMismatch: true },
      )
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(closeNodesById).not.toHaveBeenCalled()
  })

  it('forces close-all when archive is blocked by active windows', async () => {
    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()
    const closeNodesById = vi.fn(async () => undefined)
    const getBlockingNodes = vi
      .fn()
      .mockReturnValueOnce({ agentNodeIds: ['agent-1'], terminalNodeIds: ['terminal-1'] })
      .mockReturnValueOnce({ agentNodeIds: ['agent-1'], terminalNodeIds: ['terminal-1'] })
      .mockReturnValueOnce({ agentNodeIds: [], terminalNodeIds: [] })
    const { remove } = installWorktreeApi()

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".cove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={getBlockingNodes}
        closeNodesById={closeNodesById}
      />,
    )

    fireEvent.click(await screen.findByTestId('space-worktree-open-archive'))
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    expect(await screen.findByTestId('space-worktree-guard')).toBeVisible()
    expect(screen.queryByTestId('space-worktree-guard-mark-mismatch')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('space-worktree-guard-close-all'))

    await waitFor(() => {
      expect(closeNodesById).toHaveBeenCalledWith(['agent-1', 'terminal-1'])
      expect(remove).toHaveBeenCalledWith({
        repoPath: '/repo',
        worktreePath: '/repo/.cove/worktrees/space-1',
        force: false,
        deleteBranch: false,
      })
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith('space-1', '/repo', undefined)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('shows an actionable error when archive API is unavailable', async () => {
    Object.defineProperty(window, 'coveApi', {
      configurable: true,
      writable: true,
      value: {
        worktree: {
          listBranches: vi.fn(async () => ({
            current: 'main',
            branches: ['main'],
          })),
          listWorktrees: vi.fn(async () => ({
            worktrees: [{ path: '/repo/.cove/worktrees/space-1', head: 'def', branch: 'main' }],
          })),
          suggestNames: vi.fn(async () => ({
            branchName: 'space/demo',
            worktreeName: 'demo',
            provider: 'codex',
            effectiveModel: 'gpt-5.2-codex',
          })),
          create: vi.fn(async () => ({
            worktree: {
              path: '/repo/.cove/worktrees/space-demo--1a2b3c4d',
              head: null,
              branch: 'space/demo',
            },
          })),
        },
      },
    })

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".cove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={() => undefined}
        onUpdateSpaceDirectory={() => undefined}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    fireEvent.click(await screen.findByTestId('space-worktree-open-archive'))
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    expect(
      await screen.findByText('Worktree API is unavailable. Please restart Cove and try again.'),
    ).toBeVisible()
  })
})
