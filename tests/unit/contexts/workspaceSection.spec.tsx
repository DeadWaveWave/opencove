import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/WorkspaceSection'

describe('WorkspaceSection', () => {
  it('renders project worktree root controls with description', () => {
    const onChangeWorktreesRoot = vi.fn()

    render(
      <WorkspaceSection
        workspaceName="Demo Project"
        workspacePath="/repo/demo"
        worktreesRoot=".cove/worktrees"
        onChangeWorktreesRoot={onChangeWorktreesRoot}
      />,
    )

    expect(screen.getByText('Workspace Worktree')).toBeVisible()
    expect(screen.getByTestId('settings-worktree-root')).toHaveValue('.cove/worktrees')
    expect(screen.getByText(/Relative path is based on project root/i)).toBeVisible()
    expect(screen.getByText('/repo/demo/.cove/worktrees')).toBeVisible()

    fireEvent.change(screen.getByTestId('settings-worktree-root'), {
      target: { value: '/tmp/custom-worktrees' },
    })
    expect(onChangeWorktreesRoot).toHaveBeenCalledWith('/tmp/custom-worktrees')
  })

  it('shows guidance when no project is selected', () => {
    render(
      <WorkspaceSection
        workspaceName={null}
        workspacePath={null}
        worktreesRoot=""
        onChangeWorktreesRoot={() => undefined}
      />,
    )

    expect(screen.getByText(/Select a project first/i)).toBeVisible()
    expect(screen.queryByTestId('settings-worktree-root')).not.toBeInTheDocument()
  })
})
