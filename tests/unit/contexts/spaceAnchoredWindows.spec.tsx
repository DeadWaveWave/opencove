import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SpaceTargetMountPickerWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceTargetMountPickerWindow'
import { SpaceWorktreeMismatchDropWarningWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceWorktreeMismatchDropWarningWindow'
import { WorkspaceSpaceExplorerOverlayWindows } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlayWindows'

describe('anchored Space operation windows', () => {
  it('renders the mount picker at its operation anchor without an app backdrop', () => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        controlSurface: {
          invoke: vi.fn(async () => ({ endpoints: [] })),
        },
      },
    })
    const onCancel = vi.fn()

    render(
      <SpaceTargetMountPickerWindow
        picker={{
          nodeIds: ['node-1'],
          rect: null,
          mounts: [
            {
              mountId: 'mount-1',
              endpointId: 'local',
              projectId: 'project-1',
              name: 'Local',
              rootPath: '/repo',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          selectedMountId: 'mount-1',
          anchor: { x: 220, y: 96 },
        }}
        setPicker={() => undefined}
        onCancel={onCancel}
        onConfirm={() => undefined}
      />,
    )

    const picker = screen.getByTestId('workspace-space-target-mount-window')
    expect(picker).toHaveAttribute('aria-modal', 'false')
    expect(picker).toHaveStyle({ left: '220px', top: '96px' })
    expect(screen.queryByTestId('workspace-space-target-mount-backdrop')).not.toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders the directory mismatch confirmation beside the drop', () => {
    render(
      <SpaceWorktreeMismatchDropWarningWindow
        warning={{
          spaceId: 'space-1',
          spaceName: 'Infra',
          agentCount: 1,
          terminalCount: 0,
          anchor: { x: 360, y: 144 },
        }}
        onCancel={() => undefined}
        onContinue={() => undefined}
      />,
    )

    const warning = screen.getByTestId('space-worktree-mismatch-drop-warning')
    expect(warning).toHaveAttribute('aria-modal', 'false')
    expect(warning).toHaveStyle({ left: '360px', top: '144px' })
    expect(document.querySelector('.workspace-warning-dialog-backdrop')).toBeNull()
  })

  it('keeps Explorer delete confirmation beside its context-menu action', () => {
    render(
      <WorkspaceSpaceExplorerOverlayWindows
        deleteConfirmation={{
          entry: {
            kind: 'file',
            name: 'notes.md',
            uri: 'file:///repo/notes.md',
          },
          anchor: { x: 480, y: 180 },
        }}
        onCancelDelete={() => undefined}
        onConfirmDelete={() => undefined}
      />,
    )

    const confirmation = screen.getByTestId('workspace-space-explorer-delete-confirmation')
    expect(confirmation).toHaveAttribute('aria-modal', 'false')
    expect(confirmation).toHaveStyle({ left: '480px', top: '180px' })
    expect(document.querySelector('.workspace-warning-dialog-backdrop')).toBeNull()
  })
})
