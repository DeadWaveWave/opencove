import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SpaceWorktreeGuardWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceWorktreeGuardWindow'

describe('SpaceWorktreeGuardWindow', () => {
  it('supports mismatch continue and close-all actions', () => {
    const onMarkMismatchAndContinue = vi.fn()
    const onCloseAllAndContinue = vi.fn()
    const onCancel = vi.fn()

    render(
      <SpaceWorktreeGuardWindow
        guard={{
          spaceName: 'Infra',
          agentCount: 2,
          terminalCount: 1,
          pendingLabel: 'Unbind worktree',
          allowMarkMismatch: true,
          isBusy: false,
          error: null,
        }}
        onCancel={onCancel}
        onMarkMismatchAndContinue={onMarkMismatchAndContinue}
        onCloseAllAndContinue={onCloseAllAndContinue}
      />,
    )

    fireEvent.click(screen.getByTestId('space-worktree-guard-mark-mismatch'))
    expect(onMarkMismatchAndContinue).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('space-worktree-guard-close-all'))
    expect(onCloseAllAndContinue).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('space-worktree-guard-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('hides mismatch action for destructive remove flow', () => {
    render(
      <SpaceWorktreeGuardWindow
        guard={{
          spaceName: 'Infra',
          agentCount: 1,
          terminalCount: 1,
          pendingLabel: 'Detach and remove worktree',
          allowMarkMismatch: false,
          isBusy: false,
          error: null,
        }}
        onCancel={() => undefined}
        onMarkMismatchAndContinue={() => undefined}
        onCloseAllAndContinue={() => undefined}
      />,
    )

    expect(screen.queryByTestId('space-worktree-guard-mark-mismatch')).not.toBeInTheDocument()
    expect(screen.getByTestId('space-worktree-guard-close-all')).toBeVisible()
  })
})
