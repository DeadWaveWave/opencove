import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSpaceActionMenu } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceActionMenu'
import type { WorkspacePathOpener } from '../../../src/shared/types/api'

function renderMenu(
  openers: WorkspacePathOpener[],
  options?: { canCreateWorktree?: boolean; canArchive?: boolean },
) {
  render(
    <WorkspaceSpaceActionMenu
      menu={{ spaceId: 'space-1', x: 120, y: 80 }}
      availableOpeners={openers}
      canCreateWorktree={options?.canCreateWorktree ?? false}
      canArchive={options?.canArchive ?? false}
      closeMenu={() => undefined}
      onCreateWorktree={() => undefined}
      onArchive={() => undefined}
      onCopyPath={() => undefined}
      onOpenPath={() => undefined}
    />,
  )
}

describe('WorkspaceSpaceActionMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('sorts openers with Finder first, Terminal second, then alphabetically', () => {
    renderMenu([
      { id: 'zed', label: 'Zed' },
      { id: 'cursor', label: 'Cursor' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'finder', label: 'Finder' },
      { id: 'android-studio', label: 'Android Studio' },
    ])

    fireEvent.mouseEnter(screen.getByTestId('workspace-space-action-open'))

    const submenu = screen.getByTestId('workspace-space-action-open-menu')
    const labels = within(submenu)
      .getAllByRole('button')
      .map(button => button.textContent?.trim())

    expect(labels).toEqual(['Finder', 'Terminal', 'Android Studio', 'Cursor', 'Zed'])
  })

  it('keeps a hover-opened submenu alive while the pointer moves into it, then closes it', () => {
    renderMenu([
      { id: 'finder', label: 'Finder' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'cursor', label: 'Cursor' },
    ])

    act(() => {
      fireEvent.mouseEnter(screen.getByTestId('workspace-space-action-open'))
    })
    expect(screen.getByTestId('workspace-space-action-open-menu')).toBeVisible()

    act(() => {
      fireEvent.mouseLeave(screen.getByTestId('workspace-space-action-menu'))
      vi.advanceTimersByTime(60)
    })

    act(() => {
      fireEvent.mouseEnter(screen.getByTestId('workspace-space-action-open-menu'))
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByTestId('workspace-space-action-open-menu')).toBeVisible()

    act(() => {
      fireEvent.mouseLeave(screen.getByTestId('workspace-space-action-open-menu'))
      vi.advanceTimersByTime(300)
    })

    expect(screen.queryByTestId('workspace-space-action-open-menu')).not.toBeInTheDocument()
  })

  it('keeps a click-opened submenu pinned after the pointer leaves', () => {
    renderMenu([
      { id: 'finder', label: 'Finder' },
      { id: 'terminal', label: 'Terminal' },
    ])

    act(() => {
      fireEvent.click(screen.getByTestId('workspace-space-action-open'))
    })
    expect(screen.getByTestId('workspace-space-action-open-menu')).toBeVisible()

    act(() => {
      fireEvent.mouseLeave(screen.getByTestId('workspace-space-action-menu'))
      vi.advanceTimersByTime(400)
    })

    expect(screen.getByTestId('workspace-space-action-open-menu')).toBeVisible()
  })

  it('can render both create and archive actions together', () => {
    renderMenu([], { canCreateWorktree: true, canArchive: true })

    expect(screen.getByTestId('workspace-space-action-create')).toBeVisible()
    expect(screen.getByTestId('workspace-space-action-archive')).toBeVisible()
  })

  it('keeps label color second-to-last and arrange last', () => {
    render(
      <WorkspaceSpaceActionMenu
        menu={{ spaceId: 'space-1', x: 120, y: 80 }}
        availableOpeners={[
          { id: 'finder', label: 'Finder' },
          { id: 'terminal', label: 'Terminal' },
        ]}
        canArrange
        canCreateWorktree
        canArchive
        closeMenu={() => undefined}
        setSpaceLabelColor={() => undefined}
        onArrange={() => undefined}
        onCreateWorktree={() => undefined}
        onArchive={() => undefined}
        onCopyPath={() => undefined}
        onOpenPath={() => undefined}
      />,
    )

    const ids = within(screen.getByTestId('workspace-space-action-menu'))
      .getAllByRole('button')
      .map(button => button.getAttribute('data-testid'))

    expect(ids.slice(-2)).toEqual([
      'workspace-space-action-label-color',
      'workspace-space-action-arrange',
    ])
  })

  it('does not show the Open submenu when no path openers are available (web)', () => {
    renderMenu([])

    expect(screen.queryByTestId('workspace-space-action-open')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-space-action-copy-path')).toBeVisible()
  })
})
