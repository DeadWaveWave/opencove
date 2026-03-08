import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSpaceActionMenu } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceActionMenu'
import type { WorkspacePathOpener } from '../../../src/shared/types/api'

function renderMenu(openers: WorkspacePathOpener[]) {
  render(
    <WorkspaceSpaceActionMenu
      menu={{ spaceId: 'space-1', x: 120, y: 80 }}
      availableOpeners={openers}
      canCreateWorktree={false}
      canArchive={false}
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

  it('keeps the submenu open while the pointer moves into it', () => {
    renderMenu([
      { id: 'finder', label: 'Finder' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'cursor', label: 'Cursor' },
    ])

    fireEvent.mouseEnter(screen.getByTestId('workspace-space-action-open'))
    expect(screen.getByTestId('workspace-space-action-open-menu')).toBeVisible()

    fireEvent.mouseLeave(screen.getByTestId('workspace-space-action-menu'))
    act(() => {
      vi.advanceTimersByTime(60)
    })

    fireEvent.mouseEnter(screen.getByTestId('workspace-space-action-open-menu'))
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByTestId('workspace-space-action-open-menu')).toBeVisible()

    fireEvent.mouseLeave(screen.getByTestId('workspace-space-action-open-menu'))
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.queryByTestId('workspace-space-action-open-menu')).not.toBeInTheDocument()
  })
})
