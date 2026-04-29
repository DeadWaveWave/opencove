import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { SpaceWorktreeWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceWorktreeWindow'
import {
  clearWorktreeApi,
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
        onAppendSpaceArchiveRecord={() => undefined}
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
        onAppendSpaceArchiveRecord={() => undefined}
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
        onAppendSpaceArchiveRecord={() => undefined}
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
})
