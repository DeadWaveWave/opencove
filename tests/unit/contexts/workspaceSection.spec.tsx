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
        worktreesRoot=".opencove/worktrees"
        onChangeWorktreesRoot={onChangeWorktreesRoot}
        pullRequestBaseBranchOptions={[]}
        onChangePullRequestBaseBranchOptions={() => undefined}
        environmentVariables={{}}
        onChangeEnvironmentVariables={() => undefined}
      />,
    )

    expect(screen.getByText('Workspace Worktree')).toBeVisible()
    expect(screen.getByTestId('settings-workspace-path-display')).toHaveTextContent('demo')
    expect(screen.getByTestId('settings-workspace-path-display')).toHaveAttribute(
      'title',
      '/repo/demo',
    )
    expect(screen.getByTestId('settings-worktree-root')).toHaveValue('.opencove/worktrees')
    expect(screen.getByText(/Relative path is based on project root/i)).toBeVisible()
    expect(screen.getByTestId('settings-resolved-worktree-path-display')).toHaveTextContent(
      '.../.opencove/worktrees',
    )
    expect(screen.getByTestId('settings-resolved-worktree-path-display')).toHaveAttribute(
      'title',
      '/repo/demo/.opencove/worktrees',
    )

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
        pullRequestBaseBranchOptions={[]}
        onChangePullRequestBaseBranchOptions={() => undefined}
        environmentVariables={{}}
        onChangeEnvironmentVariables={() => undefined}
      />,
    )

    expect(screen.getByText(/Select a project first/i)).toBeVisible()
    expect(screen.queryByTestId('settings-worktree-root')).not.toBeInTheDocument()
  })

  it('renders Environment Variables section when workspace is selected', () => {
    render(
      <WorkspaceSection
        workspaceName="Demo"
        workspacePath="/repo/demo"
        worktreesRoot=""
        onChangeWorktreesRoot={() => undefined}
        pullRequestBaseBranchOptions={[]}
        onChangePullRequestBaseBranchOptions={() => undefined}
        environmentVariables={{}}
        onChangeEnvironmentVariables={() => undefined}
      />,
    )

    expect(screen.getByText('Environment Variables')).toBeVisible()
    expect(screen.getByText(/No environment variables configured/i)).toBeVisible()
  })

  it('does not render Environment Variables section when no workspace is selected', () => {
    render(
      <WorkspaceSection
        workspaceName={null}
        workspacePath={null}
        worktreesRoot=""
        onChangeWorktreesRoot={() => undefined}
        pullRequestBaseBranchOptions={[]}
        onChangePullRequestBaseBranchOptions={() => undefined}
        environmentVariables={{}}
        onChangeEnvironmentVariables={() => undefined}
      />,
    )

    expect(screen.queryByText('Environment Variables')).not.toBeInTheDocument()
  })

  it('renders existing environment variables', () => {
    render(
      <WorkspaceSection
        workspaceName="Demo"
        workspacePath="/repo/demo"
        worktreesRoot=""
        onChangeWorktreesRoot={() => undefined}
        pullRequestBaseBranchOptions={[]}
        onChangePullRequestBaseBranchOptions={() => undefined}
        environmentVariables={{ NODE_ENV: 'production', DEBUG: 'true' }}
        onChangeEnvironmentVariables={() => undefined}
      />,
    )

    expect(screen.getByText('NODE_ENV')).toBeVisible()
    expect(screen.getByText('DEBUG')).toBeVisible()
    expect(screen.queryByText(/No environment variables configured/i)).not.toBeInTheDocument()
  })

  it('adds a new environment variable', () => {
    const onChangeEnvironmentVariables = vi.fn()

    render(
      <WorkspaceSection
        workspaceName="Demo"
        workspacePath="/repo/demo"
        worktreesRoot=""
        onChangeWorktreesRoot={() => undefined}
        pullRequestBaseBranchOptions={[]}
        onChangePullRequestBaseBranchOptions={() => undefined}
        environmentVariables={{}}
        onChangeEnvironmentVariables={onChangeEnvironmentVariables}
      />,
    )

    fireEvent.change(screen.getByTestId('settings-env-var-key-input'), {
      target: { value: 'NODE_ENV' },
    })
    fireEvent.change(screen.getByTestId('settings-env-var-value-input'), {
      target: { value: 'development' },
    })
    fireEvent.click(screen.getByTestId('settings-env-var-add-button'))

    expect(onChangeEnvironmentVariables).toHaveBeenCalledWith({ NODE_ENV: 'development' })
  })

  it('removes an environment variable', () => {
    const onChangeEnvironmentVariables = vi.fn()

    render(
      <WorkspaceSection
        workspaceName="Demo"
        workspacePath="/repo/demo"
        worktreesRoot=""
        onChangeWorktreesRoot={() => undefined}
        pullRequestBaseBranchOptions={[]}
        onChangePullRequestBaseBranchOptions={() => undefined}
        environmentVariables={{ NODE_ENV: 'production', DEBUG: 'true' }}
        onChangeEnvironmentVariables={onChangeEnvironmentVariables}
      />,
    )

    fireEvent.click(screen.getByTestId('settings-env-var-remove-NODE_ENV'))

    expect(onChangeEnvironmentVariables).toHaveBeenCalledWith({ DEBUG: 'true' })
  })

  it('disables Add button when key input is empty', () => {
    render(
      <WorkspaceSection
        workspaceName="Demo"
        workspacePath="/repo/demo"
        worktreesRoot=""
        onChangeWorktreesRoot={() => undefined}
        pullRequestBaseBranchOptions={[]}
        onChangePullRequestBaseBranchOptions={() => undefined}
        environmentVariables={{}}
        onChangeEnvironmentVariables={() => undefined}
      />,
    )

    expect(screen.getByTestId('settings-env-var-add-button')).toBeDisabled()
  })
})
