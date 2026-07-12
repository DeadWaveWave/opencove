import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { SpaceWorktreeWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceWorktreeWindow'
import { createNodes, createSpaces } from './spaceWorktreeWindow.testUtils'

type SpaceWorktreeWindowProps = React.ComponentProps<typeof SpaceWorktreeWindow>

export function renderArchiveWindow(overrides: Partial<SpaceWorktreeWindowProps> = {}) {
  const onClose = overrides.onClose ?? vi.fn()
  const onShowMessage = overrides.onShowMessage
  const onAppendSpaceArchiveRecord = overrides.onAppendSpaceArchiveRecord ?? vi.fn()
  const onUpdateSpaceDirectory = overrides.onUpdateSpaceDirectory ?? vi.fn()
  const onOperationPhaseChange = overrides.onOperationPhaseChange ?? vi.fn()
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
      onOperationPhaseChange={onOperationPhaseChange}
      onShowMessage={onShowMessage}
      onAppendSpaceArchiveRecord={onAppendSpaceArchiveRecord}
      onUpdateSpaceDirectory={onUpdateSpaceDirectory}
      getBlockingNodes={getBlockingNodes}
      closeNodesById={closeNodesById}
    />,
  )

  return {
    closeNodesById,
    onAppendSpaceArchiveRecord,
    onClose,
    onOperationPhaseChange,
    onUpdateSpaceDirectory,
  }
}

export async function submitArchive(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('space-worktree-archive-submit')).not.toBeDisabled()
  })
  fireEvent.click(screen.getByTestId('space-worktree-archive-submit'))
}
