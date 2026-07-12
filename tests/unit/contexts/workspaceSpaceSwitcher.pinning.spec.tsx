import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSpaceState } from '@contexts/workspace/presentation/renderer/types'
import { WorkspaceCanvasTopOverlays } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceCanvasTopOverlays'

function createSpace(
  id: string,
  options: { pinned?: boolean; sortOrder?: number; parentSpaceId?: string | null } = {},
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/tmp',
    targetMountId: null,
    parentSpaceId: options.parentSpaceId,
    sortOrder: options.sortOrder,
    pinned: options.pinned,
    labelColor: null,
    nodeIds: [],
    rect: null,
  }
}

function renderOverlays(
  spaces: WorkspaceSpaceState[],
  onOpenSpaceContextMenu = vi.fn(),
): ReturnType<typeof vi.fn> {
  render(
    <WorkspaceCanvasTopOverlays
      spaces={spaces}
      activateSpace={vi.fn()}
      activateAllSpaces={vi.fn()}
      cancelSpaceRename={vi.fn()}
      onOpenSpaceContextMenu={onOpenSpaceContextMenu}
      usedLabelColors={[]}
      activeLabelColorFilter={null}
      onToggleLabelColorFilter={vi.fn()}
      selectedNodeCount={0}
    />,
  )
  return onOpenSpaceContextMenu
}

describe('WorkspaceSpaceSwitcher pin projection', () => {
  it('hides the switcher when no top-level space is pinned', () => {
    renderOverlays([
      createSpace('plain'),
      createSpace('child', { pinned: true, parentSpaceId: 'plain' }),
    ])

    expect(screen.queryByTestId('workspace-space-switch-all')).toBeNull()
  })

  it('shows only pinned root spaces in stable pin order', () => {
    renderOverlays([
      createSpace('plain', { sortOrder: 0 }),
      createSpace('pinned-b', { pinned: true, sortOrder: 2 }),
      createSpace('pinned-a', { pinned: true, sortOrder: 1 }),
    ])

    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      'All',
      'pinned-a',
      'pinned-b',
    ])
    expect(screen.queryByTestId('workspace-space-switch-plain')).toBeNull()
  })

  it('opens the shared sidebar space menu from a pill context click', () => {
    const onOpenSpaceContextMenu = renderOverlays([createSpace('pinned', { pinned: true })])

    fireEvent.contextMenu(screen.getByTestId('workspace-space-switch-pinned'), {
      clientX: 42,
      clientY: 64,
    })

    expect(onOpenSpaceContextMenu).toHaveBeenCalledWith('pinned', { x: 42, y: 64 })
  })
})
