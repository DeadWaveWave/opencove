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

type SpaceWorktreeWindowProps = React.ComponentProps<typeof SpaceWorktreeWindow>

function renderArchiveWindow(overrides: Partial<SpaceWorktreeWindowProps> = {}) {
  const onClose = overrides.onClose ?? vi.fn()
  const onShowMessage = overrides.onShowMessage
  const onAppendSpaceArchiveRecord = overrides.onAppendSpaceArchiveRecord ?? vi.fn()
  const onUpdateSpaceDirectory = overrides.onUpdateSpaceDirectory ?? vi.fn()
  const closeNodesById = overrides.closeNodesById ?? vi.fn(async () => undefined)
  const getBlockingNodes =
    overrides.getBlockingNodes ?? (() => ({ agentNodeIds: [], terminalNodeIds: [] }))

  render(
    <SpaceWorktreeWindow
      spaceId={overrides.spaceId ?? 'space-1'}
      initialViewMode="archive"
      spaces={overrides.spaces ?? createSpaces()}
      nodes={overrides.nodes ?? createNodes()}
      workspacePath={overrides.workspacePath ?? '/repo'}
      worktreesRoot={overrides.worktreesRoot ?? '.opencove/worktrees'}
      agentSettings={overrides.agentSettings ?? DEFAULT_AGENT_SETTINGS}
      onClose={onClose}
      onShowMessage={onShowMessage}
      onAppendSpaceArchiveRecord={onAppendSpaceArchiveRecord}
      onUpdateSpaceDirectory={onUpdateSpaceDirectory}
      getBlockingNodes={getBlockingNodes}
      closeNodesById={closeNodesById}
    />,
  )

  return { closeNodesById, onAppendSpaceArchiveRecord, onClose, onUpdateSpaceDirectory }
}

describe('SpaceWorktreeWindow archive flow', () => {
  afterEach(() => {
    clearWorktreeApi()
  })

  it('archives a managed worktree and can delete its branch', async () => {
    const { remove } = installWorktreeApi({
      remove: vi.fn(async () => ({
        deletedBranchName: 'feature/demo',
        branchDeleteError: null,
        directoryCleanupError: null,
      })),
    })
    const { onClose, onUpdateSpaceDirectory } = renderArchiveWindow()

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-force-confirm')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-force-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-submit')).not.toBeDisabled()
    })
    expect(screen.getByTestId('space-worktree-archive-cancel')).toBeVisible()
    expect(screen.getByTestId('space-worktree-archive-close-only')).toHaveTextContent(
      'Execute & Close',
    )
    expect(screen.getByTestId('space-worktree-archive-submit')).toHaveTextContent(
      'Execute & Archive',
    )
    expect(screen.getByTestId('space-worktree-archive-delete-worktree')).toBeChecked()
    expect(screen.getByTestId('space-worktree-archive-delete-branch')).not.toBeChecked()
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

  it('archives a managed worktree space without deleting its worktree when unchecked', async () => {
    const { remove } = installWorktreeApi({
      statusSummary: vi.fn(async () => ({ changedFileCount: 0 })),
    })
    const { onClose, onUpdateSpaceDirectory } = renderArchiveWindow()

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-delete-worktree')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('space-worktree-archive-delete-worktree'))
    expect(screen.getByTestId('space-worktree-archive-delete-branch')).toBeDisabled()
    fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))

    await waitFor(() => {
      expect(remove).not.toHaveBeenCalled()
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith('space-1', '/repo', {
        archiveSpace: true,
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('closes a managed worktree space without saving an archive record', async () => {
    const { remove } = installWorktreeApi({
      statusSummary: vi.fn(async () => ({ changedFileCount: 0 })),
    })
    const { onAppendSpaceArchiveRecord, onClose, onUpdateSpaceDirectory } = renderArchiveWindow()

    await waitFor(() => {
      expect(screen.getByTestId('space-worktree-archive-close-only')).not.toBeDisabled()
    })
    expect(screen.queryByTestId('space-worktree-archive-skip-history')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('space-worktree-archive-close-only'))

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith({
        repoPath: '/repo',
        worktreePath: '/repo/.opencove/worktrees/space-1',
        force: true,
        deleteBranch: false,
      })
      expect(onUpdateSpaceDirectory).toHaveBeenCalledWith('space-1', '/repo', {
        archiveSpace: true,
      })
      expect(onAppendSpaceArchiveRecord).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('archives a root-backed space without removing any worktree', async () => {
    const { remove } = installWorktreeApi({
      listWorktrees: vi.fn(async () => ({
        worktrees: [{ path: '/repo', head: 'abc', branch: 'main' }],
      })),
    })
    const { onClose, onUpdateSpaceDirectory } = renderArchiveWindow({
      spaces: createSpaces('/repo'),
    })

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

  it('auto-closes active windows before archiving a managed worktree space', async () => {
    const getBlockingNodes = vi
      .fn()
      .mockReturnValueOnce({ agentNodeIds: ['agent-1'], terminalNodeIds: ['terminal-1'] })
      .mockReturnValueOnce({ agentNodeIds: [], terminalNodeIds: [] })
    const { remove } = installWorktreeApi()
    const { closeNodesById, onClose, onUpdateSpaceDirectory } = renderArchiveWindow({
      getBlockingNodes,
    })

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
    installWorktreeApi({
      listWorktrees: vi.fn(async () => ({
        worktrees: [{ path: '/repo', head: 'abc', branch: 'main' }],
      })),
    })
    const getBlockingNodes = vi
      .fn()
      .mockReturnValueOnce({ agentNodeIds: ['agent-1'], terminalNodeIds: [] })
      .mockReturnValueOnce({ agentNodeIds: [], terminalNodeIds: [] })
    const { closeNodesById, onClose, onUpdateSpaceDirectory } = renderArchiveWindow({
      getBlockingNodes,
      spaces: createSpaces('/repo'),
    })

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
    renderArchiveWindow({ nodes, spaces })

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
          listBranches: vi.fn(async () => ({ branches: ['main'], current: 'main' })),
          listWorktrees: vi.fn(async () => ({
            worktrees: [{ path: '/repo/.opencove/worktrees/space-1', head: 'def', branch: 'main' }],
          })),
          statusSummary: vi.fn(async () => ({ changedFileCount: 3 })),
          suggestNames: vi.fn(async () => ({
            branchName: 'space/demo',
            effectiveModel: 'gpt-5.2-codex',
            provider: 'codex',
            worktreeName: 'demo',
          })),
          create: vi.fn(async () => ({
            worktree: {
              branch: 'space/demo',
              head: null,
              path: '/repo/.opencove/worktrees/space-demo--1a2b3c4d',
            },
          })),
        },
      },
    })
    renderArchiveWindow()

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
    const onShowMessage = vi.fn()
    installWorktreeApi({
      remove: vi.fn(async () => ({
        branchDeleteError: { code: 'worktree.remove_branch_cleanup_failed' },
        deletedBranchName: null,
        directoryCleanupError: { code: 'worktree.remove_directory_cleanup_failed' },
      })),
    })
    const { onClose, onUpdateSpaceDirectory } = renderArchiveWindow({ onShowMessage })

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
