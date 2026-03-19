import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { SpaceWorktreeWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceWorktreeWindow'
import {
  clearWorktreeApi,
  createArchiveSummaryScenario,
  createNodes,
  createSpaces,
  installWorktreeApi,
} from './spaceWorktreeWindow.testUtils'

describe('SpaceWorktreeWindow flow', () => {
  afterEach(() => {
    clearWorktreeApi()
  })

  it('opens create and archive views directly without an intermediate home screen', async () => {
    const { statusSummary } = installWorktreeApi()

    const { rerender } = render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="archive"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={() => undefined}
        onUpdateSpaceDirectory={() => undefined}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    expect(await screen.findByTestId('space-worktree-archive-view')).toBeVisible()
    expect(screen.getByTestId('space-worktree-status')).toHaveTextContent('feature/demo')
    expect(screen.getByTestId('space-worktree-status')).toHaveTextContent('3 changes')
    expect(screen.getByTestId('space-worktree-archive-uncommitted-warning')).toHaveTextContent(
      'uncommitted changes',
    )
    expect(statusSummary).toHaveBeenCalledWith({
      repoPath: '/repo/.opencove/worktrees/space-1',
    })
    expect(screen.queryByTestId('space-worktree-home-view')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-force-confirm')).not.toBeDisabled()
    })
    expect(screen.getByTestId('space-worktree-archive-submit')).toBeDisabled()
    fireEvent.click(screen.getByTestId('space-worktree-archive-force-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-submit')).not.toBeDisabled()
    })

    rerender(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="create"
        spaces={createSpaces('/repo')}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={() => undefined}
        onUpdateSpaceDirectory={() => undefined}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    expect(await screen.findByTestId('space-worktree-create-view')).toBeVisible()
    expect(statusSummary).toHaveBeenLastCalledWith({
      repoPath: '/repo',
    })
    expect(screen.queryByTestId('space-worktree-home-view')).not.toBeInTheDocument()
    expect(screen.queryByTestId('space-worktree-suggest-ai')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-create')).not.toBeDisabled()
    })
  })

  it('archives a managed worktree and can delete its branch', async () => {
    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()
    const { remove } = installWorktreeApi({
      remove: vi.fn(async () => ({
        deletedBranchName: 'feature/demo',
        branchDeleteError: null,
        directoryCleanupError: null,
      })),
    })

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="archive"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onShowMessage={undefined}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-force-confirm')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-force-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-submit')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-delete-branch'))
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith({
        repoPath: '/repo',
        worktreePath: '/repo/.opencove/worktrees/space-1',
        force: true,
        deleteBranch: true,
      })
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith('space-1', '/repo', {
        archiveSpace: true,
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('archives a root-backed space without removing any worktree', async () => {
    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()
    const { remove } = installWorktreeApi({
      listWorktrees: vi.fn(async () => ({
        worktrees: [{ path: '/repo', head: 'abc', branch: 'main' }],
      })),
    })

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="archive"
        spaces={createSpaces('/repo')}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onShowMessage={undefined}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    expect(screen.queryByTestId('space-worktree-archive-delete-branch')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-submit')).not.toBeDisabled()
    })

    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    await waitFor(() => {
      expect(remove).not.toHaveBeenCalled()
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
        initialViewMode="create"
        spaces={createSpaces('/repo')}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onShowMessage={undefined}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: ['agent-1'], terminalNodeIds: ['terminal-1'] })}
        closeNodesById={closeNodesById}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-create')).not.toBeDisabled()
    })
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
        '/repo/.opencove/worktrees/space-demo--1a2b3c4d',
        expect.objectContaining({
          markNodeDirectoryMismatch: true,
          renameSpaceTo: 'space/demo',
        }),
      )
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(closeNodesById).not.toHaveBeenCalled()
  })

  it('auto-closes active windows before archiving a managed worktree space', async () => {
    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()
    const closeNodesById = vi.fn(async () => undefined)
    const getBlockingNodes = vi
      .fn()
      .mockReturnValueOnce({ agentNodeIds: ['agent-1'], terminalNodeIds: ['terminal-1'] })
      .mockReturnValueOnce({ agentNodeIds: [], terminalNodeIds: [] })
    const { remove } = installWorktreeApi()

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="archive"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onShowMessage={undefined}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={getBlockingNodes}
        closeNodesById={closeNodesById}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-force-confirm')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-force-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-submit')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    await waitFor(() => {
      expect(closeNodesById).toHaveBeenCalledWith(['agent-1', 'terminal-1'])
      expect(remove).toHaveBeenCalledWith({
        repoPath: '/repo',
        worktreePath: '/repo/.opencove/worktrees/space-1',
        force: true,
        deleteBranch: false,
      })
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith('space-1', '/repo', {
        archiveSpace: true,
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('archives a root-backed space after closing active windows without opening a guard', async () => {
    const onClose = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()
    installWorktreeApi({
      listWorktrees: vi.fn(async () => ({
        worktrees: [{ path: '/repo', head: 'abc', branch: 'main' }],
      })),
    })
    const closeNodesById = vi.fn(async () => undefined)
    const getBlockingNodes = vi
      .fn()
      .mockReturnValueOnce({ agentNodeIds: ['agent-1'], terminalNodeIds: [] })
      .mockReturnValueOnce({ agentNodeIds: [], terminalNodeIds: [] })

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="archive"
        spaces={createSpaces('/repo')}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onShowMessage={undefined}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={getBlockingNodes}
        closeNodesById={closeNodesById}
      />,
    )

    expect(screen.queryByTestId('space-worktree-archive-force-confirm')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-submit')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    await waitFor(() => {
      expect(closeNodesById).toHaveBeenCalledWith(['agent-1'])
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith('space-1', '/repo', {
        archiveSpace: true,
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByTestId('space-worktree-guard')).not.toBeInTheDocument()
  })

  it('shows archive title summary counts beside the heading', async () => {
    installWorktreeApi()
    const { spaces, nodes } = createArchiveSummaryScenario()

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="archive"
        spaces={spaces}
        nodes={nodes}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={() => undefined}
        onShowMessage={undefined}
        onUpdateSpaceDirectory={() => undefined}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    expect(await screen.findByText('Archive Worktree Space')).toBeVisible()
    expect(screen.getByTestId('space-worktree-archive-summary')).toHaveTextContent(
      '1 agent · 1 terminal · 1 task · 1 note',
    )
  })

  it('shows an actionable error when archive API is unavailable', async () => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        worktree: {
          listBranches: vi.fn(async () => ({
            current: 'main',
            branches: ['main'],
          })),
          listWorktrees: vi.fn(async () => ({
            worktrees: [{ path: '/repo/.opencove/worktrees/space-1', head: 'def', branch: 'main' }],
          })),
          statusSummary: vi.fn(async () => ({
            changedFileCount: 3,
          })),
          suggestNames: vi.fn(async () => ({
            branchName: 'space/demo',
            worktreeName: 'demo',
            provider: 'codex',
            effectiveModel: 'gpt-5.2-codex',
          })),
          create: vi.fn(async () => ({
            worktree: {
              path: '/repo/.opencove/worktrees/space-demo--1a2b3c4d',
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
        initialViewMode="archive"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={() => undefined}
        onShowMessage={undefined}
        onUpdateSpaceDirectory={() => undefined}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-force-confirm')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-force-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-submit')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    expect(
      await screen.findByText(
        'Worktree API is unavailable. Please restart OpenCove and try again.',
      ),
    ).toBeVisible()
  })

  it('archives a managed worktree and surfaces cleanup warnings through app message', async () => {
    const onClose = vi.fn()
    const onShowMessage = vi.fn()
    const onUpdateSpaceDirectory = vi.fn()

    installWorktreeApi({
      remove: vi.fn(async () => ({
        deletedBranchName: null,
        branchDeleteError: {
          code: 'worktree.remove_branch_cleanup_failed',
        },
        directoryCleanupError: {
          code: 'worktree.remove_directory_cleanup_failed',
        },
      })),
    })

    render(
      <SpaceWorktreeWindow
        spaceId="space-1"
        initialViewMode="archive"
        spaces={createSpaces()}
        nodes={createNodes()}
        workspacePath="/repo"
        worktreesRoot=".opencove/worktrees"
        agentSettings={DEFAULT_AGENT_SETTINGS}
        onClose={onClose}
        onShowMessage={onShowMessage}
        onUpdateSpaceDirectory={onUpdateSpaceDirectory}
        getBlockingNodes={() => ({ agentNodeIds: [], terminalNodeIds: [] })}
        closeNodesById={async () => undefined}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-force-confirm')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-force-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-submit')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    await waitFor(() => {
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith('space-1', '/repo', {
        archiveSpace: true,
      })
      expect(onShowMessage).toHaveBeenCalledWith(
        'Space archived, but the worktree directory could not be removed. Close any process still using it, then delete the directory manually. Space archived, but the branch could not be deleted.',
        'warning',
      )
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
