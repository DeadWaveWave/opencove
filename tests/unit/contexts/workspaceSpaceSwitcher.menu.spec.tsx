import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSpaceRegionsOverlay } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceRegionsOverlay'

vi.mock('@xyflow/react', () => {
  return {
    ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

describe('WorkspaceSpaceRegionsOverlay space actions', () => {
  afterEach(() => {
    delete (window as unknown as { coveApi?: unknown }).coveApi
  })

  it('opens the space action menu via the ... pill', () => {
    const onOpenSpaceMenu = vi.fn()

    render(
      <WorkspaceSpaceRegionsOverlay
        workspacePath="/tmp"
        spaceVisuals={[
          {
            id: 'space-1',
            name: 'Infra',
            directoryPath: '/tmp',
            rect: { x: 0, y: 0, width: 200, height: 160 },
            hasExplicitRect: true,
          },
        ]}
        selectedSpaceIds={[]}
        spaceFramePreview={null}
        handleSpaceDragHandlePointerDown={() => undefined}
        editingSpaceId={null}
        spaceRenameInputRef={{ current: null }}
        spaceRenameDraft=""
        setSpaceRenameDraft={() => undefined}
        commitSpaceRename={() => undefined}
        cancelSpaceRename={() => undefined}
        startSpaceRename={() => undefined}
        onOpenSpaceMenu={onOpenSpaceMenu}
      />,
    )

    fireEvent.click(screen.getByTestId('workspace-space-menu-space-1'))
    expect(onOpenSpaceMenu).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    )
  })

  it('shows only the branch badge when bound to a git worktree', async () => {
    const listWorktrees = vi.fn(async () => {
      return {
        worktrees: [
          {
            path: '/tmp/repo/.cove/worktrees/wt-infra',
            head: '69a0358e3f7d88f1d8af8ff302d8b69bcd1b4d45',
            branch: 'feat/infra-pill',
          },
        ],
      }
    })

    Object.defineProperty(window, 'coveApi', {
      configurable: true,
      writable: true,
      value: {
        worktree: {
          listWorktrees,
          renameBranch: vi.fn(async () => undefined),
        },
      },
    })

    render(
      <WorkspaceSpaceRegionsOverlay
        workspacePath="/tmp/repo"
        spaceVisuals={[
          {
            id: 'space-1',
            name: 'Infra',
            directoryPath: '/tmp/repo/.cove/worktrees/wt-infra',
            rect: { x: 0, y: 0, width: 200, height: 160 },
            hasExplicitRect: true,
          },
        ]}
        selectedSpaceIds={[]}
        spaceFramePreview={null}
        handleSpaceDragHandlePointerDown={() => undefined}
        editingSpaceId={null}
        spaceRenameInputRef={{ current: null }}
        spaceRenameDraft=""
        setSpaceRenameDraft={() => undefined}
        commitSpaceRename={() => undefined}
        cancelSpaceRename={() => undefined}
        startSpaceRename={() => undefined}
      />,
    )

    await waitFor(() => {
      expect(listWorktrees).toHaveBeenCalledWith({ repoPath: '/tmp/repo' })
    })

    expect(screen.queryByTestId('workspace-space-worktree-name-space-1')).not.toBeInTheDocument()
    expect(await screen.findByTestId('workspace-space-worktree-branch-space-1')).toHaveTextContent(
      'feat/infra-pill',
    )
  })

  it('renames the bound branch after confirmation', async () => {
    let branchName = 'feat/infra-pill'
    const listWorktrees = vi.fn(async () => {
      return {
        worktrees: [
          {
            path: '/tmp/repo/.cove/worktrees/wt-infra',
            head: '69a0358e3f7d88f1d8af8ff302d8b69bcd1b4d45',
            branch: branchName,
          },
        ],
      }
    })
    const renameBranch = vi.fn(async ({ nextName }: { nextName: string }) => {
      branchName = nextName
    })

    Object.defineProperty(window, 'coveApi', {
      configurable: true,
      writable: true,
      value: {
        worktree: {
          listWorktrees,
          renameBranch,
        },
      },
    })

    render(
      <WorkspaceSpaceRegionsOverlay
        workspacePath="/tmp/repo"
        spaceVisuals={[
          {
            id: 'space-1',
            name: 'Infra',
            directoryPath: '/tmp/repo/.cove/worktrees/wt-infra',
            rect: { x: 0, y: 0, width: 200, height: 160 },
            hasExplicitRect: true,
          },
        ]}
        selectedSpaceIds={[]}
        spaceFramePreview={null}
        handleSpaceDragHandlePointerDown={() => undefined}
        editingSpaceId={null}
        spaceRenameInputRef={{ current: null }}
        spaceRenameDraft=""
        setSpaceRenameDraft={() => undefined}
        commitSpaceRename={() => undefined}
        cancelSpaceRename={() => undefined}
        startSpaceRename={() => undefined}
      />,
    )

    fireEvent.click(await screen.findByTestId('workspace-space-worktree-branch-space-1'))
    expect(await screen.findByTestId('workspace-space-branch-rename-dialog')).toBeVisible()

    fireEvent.change(screen.getByTestId('workspace-space-branch-rename-input'), {
      target: { value: 'feat/infra-next' },
    })
    fireEvent.click(screen.getByTestId('workspace-space-branch-rename-submit'))

    await waitFor(() => {
      expect(renameBranch).toHaveBeenCalledWith({
        repoPath: '/tmp/repo',
        worktreePath: '/tmp/repo/.cove/worktrees/wt-infra',
        currentName: 'feat/infra-pill',
        nextName: 'feat/infra-next',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('workspace-space-worktree-branch-space-1')).toHaveTextContent(
        'feat/infra-next',
      )
    })
  })

  it('validates unsupported branch names before renaming', async () => {
    const renameBranch = vi.fn(async () => undefined)

    Object.defineProperty(window, 'coveApi', {
      configurable: true,
      writable: true,
      value: {
        worktree: {
          listWorktrees: vi.fn(async () => ({
            worktrees: [
              {
                path: '/tmp/repo/.cove/worktrees/wt-infra',
                head: '69a0358e3f7d88f1d8af8ff302d8b69bcd1b4d45',
                branch: 'feat/infra-pill',
              },
            ],
          })),
          renameBranch,
        },
      },
    })

    render(
      <WorkspaceSpaceRegionsOverlay
        workspacePath="/tmp/repo"
        spaceVisuals={[
          {
            id: 'space-1',
            name: 'Infra',
            directoryPath: '/tmp/repo/.cove/worktrees/wt-infra',
            rect: { x: 0, y: 0, width: 200, height: 160 },
            hasExplicitRect: true,
          },
        ]}
        selectedSpaceIds={[]}
        spaceFramePreview={null}
        handleSpaceDragHandlePointerDown={() => undefined}
        editingSpaceId={null}
        spaceRenameInputRef={{ current: null }}
        spaceRenameDraft=""
        setSpaceRenameDraft={() => undefined}
        commitSpaceRename={() => undefined}
        cancelSpaceRename={() => undefined}
        startSpaceRename={() => undefined}
      />,
    )

    fireEvent.click(await screen.findByTestId('workspace-space-worktree-branch-space-1'))
    fireEvent.change(screen.getByTestId('workspace-space-branch-rename-input'), {
      target: { value: 'bad name' },
    })
    fireEvent.click(screen.getByTestId('workspace-space-branch-rename-submit'))

    expect(await screen.findByText('Branch name contains unsupported characters.')).toBeVisible()
    expect(renameBranch).not.toHaveBeenCalled()
  })
})
