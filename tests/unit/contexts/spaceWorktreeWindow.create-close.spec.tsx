import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { SpaceWorktreeWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceWorktreeWindow'
import { createAppError } from '../../../src/shared/errors/appError'
import {
  clearWorktreeApi,
  createNodes,
  createSpaces,
  installWorktreeApi,
} from './spaceWorktreeWindow.testUtils'

describe('SpaceWorktreeWindow create flow', () => {
  afterEach(() => {
    clearWorktreeApi()
  })

  it('calls onClose after creating and binding a worktree', async () => {
    const listBranches = vi.fn(async () => ({
      current: 'main',
      branches: ['main', 'feature/demo'],
    }))
    const listWorktrees = vi.fn(async () => ({
      worktrees: [{ path: '/repo', head: 'abc', branch: 'main' }],
    }))
    const statusSummary = vi.fn(async () => ({
      changedFileCount: 0,
    }))
    const create = vi.fn(async () => ({
      worktree: {
        path: '/repo/.opencove/worktrees/space-demo--1a2b3c4d',
        head: null,
        branch: 'space/demo',
      },
    }))
    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        worktree: {
          listBranches,
          listWorktrees,
          statusSummary,
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
            directoryCleanupError: null,
          })),
        },
      },
    })

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="create"
        spaces={createSpaces('/repo')}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    await waitFor(() => {
      expect(listBranches).toHaveBeenCalledTimes(1)
      expect(listWorktrees).toHaveBeenCalledTimes(1)
      expect(statusSummary).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('space-worktree-create')).not.toBeDisabled()
    })

    expect(await screen.findByTestId('space-worktree-create-view')).toBeVisible()
    expect(screen.queryByTestId('space-worktree-name')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('space-worktree-start-point-trigger'))
    expect(screen.getByRole('listbox')).toHaveClass('cove-select__menu--within-dialog')
    fireEvent.click(screen.getByRole('option', { name: 'main' }))

    fireEvent.change(screen.getByTestId('space-worktree-branch-name'), {
      target: { value: 'space/demo' },
    })
    fireEvent.click(screen.getByTestId('space-worktree-create'))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        repoPath: '/repo',
        worktreesRoot: '/repo/.opencove/worktrees',
        branchMode: { kind: 'new', name: 'space/demo', startPoint: 'main' },
      })
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith(
        'space-1',
        '/repo/.opencove/worktrees/space-demo--1a2b3c4d',
        { renameSpaceTo: 'space/demo' },
      )
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('dismisses the anchored editor after submit while the operation continues', async () => {
    let resolveCreate:
      | ((value: { worktree: { path: string; head: null; branch: string } }) => void)
      | null = null
    const create = vi.fn(
      () =>
        new Promise<{ worktree: { path: string; head: null; branch: string } }>(resolve => {
          resolveCreate = resolve
        }),
    )
    installWorktreeApi({ create })
    const onClose = vi.fn()
    const onOperationPhaseChange = vi.fn()

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="create"
        anchor={{ x: 300, y: 90 }}
        operationPhase="draft"
        spaces={createSpaces('/repo')}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onOperationPhaseChange={onOperationPhaseChange}
        onUpdateSpaceDirectory={() => undefined}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-create')).not.toBeDisabled()
    })
    fireEvent.change(screen.getByTestId('space-worktree-branch-name'), {
      target: { value: 'space/demo' },
    })
    fireEvent.click(screen.getByTestId('space-worktree-create'))

    await waitFor(() => {
      expect(onOperationPhaseChange).toHaveBeenCalledWith('running')
      expect(screen.queryByTestId('space-worktree-window')).not.toBeInTheDocument()
    })
    expect(onClose).not.toHaveBeenCalled()

    resolveCreate?.({
      worktree: {
        path: '/repo/.opencove/worktrees/space-demo',
        head: null,
        branch: 'space/demo',
      },
    })
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('clears the mount projection when binding an existing branch checked out outside the project root', async () => {
    const create = vi.fn(async () => ({
      worktree: {
        path: '/external/worktrees/feature-existing',
        head: null,
        branch: 'feature/existing',
      },
    }))
    installWorktreeApi({
      listBranches: vi.fn(async () => ({
        current: 'main',
        branches: ['main', 'feature/existing'],
      })),
      listWorktrees: vi.fn(async () => ({
        worktrees: [
          { path: '/repo', head: 'abc', branch: 'main' },
          {
            path: '/external/worktrees/feature-existing',
            head: 'def',
            branch: 'feature/existing',
          },
        ],
      })),
      statusSummary: vi.fn(async () => ({
        changedFileCount: 0,
      })),
      create,
    })

    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()
    const spaces = createSpaces('/repo').map(space => ({
      ...space,
      targetMountId: 'mount-1',
    }))

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="create"
        spaces={spaces}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-create')).not.toBeDisabled()
    })

    fireEvent.click(screen.getByTestId('space-worktree-mode-existing'))
    fireEvent.click(screen.getByTestId('space-worktree-existing-branch-trigger'))
    const existingBranchOption = screen
      .getAllByRole('option')
      .find(option => option.textContent?.includes('feature/existing'))
    expect(existingBranchOption).toBeTruthy()
    fireEvent.click(existingBranchOption as HTMLElement)
    fireEvent.click(screen.getByTestId('space-worktree-create'))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        repoPath: '/repo',
        worktreesRoot: '/repo/.opencove/worktrees',
        branchMode: { kind: 'existing', name: 'feature/existing' },
      })
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith(
        'space-1',
        '/external/worktrees/feature-existing',
        {
          targetMountId: null,
          renameSpaceTo: 'feature/existing',
        },
      )
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('surfaces an actionable error when creating a worktree in a repo with no commits', async () => {
    installWorktreeApi({
      create: vi.fn(async () => {
        throw createAppError('worktree.repo_has_no_commits')
      }),
    })

    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="create"
        spaces={createSpaces('/repo')}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-create')).not.toBeDisabled()
    })

    fireEvent.change(screen.getByTestId('space-worktree-branch-name'), {
      target: { value: 'space/demo' },
    })
    fireEvent.click(screen.getByTestId('space-worktree-create'))

    expect(await screen.findByText(/no commits yet/i)).toBeVisible()
    expect(onUpdateSpaceDirectory).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
