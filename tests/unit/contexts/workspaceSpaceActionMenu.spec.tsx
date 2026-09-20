import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSpaceActionMenu } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceActionMenu'
import {
  WorkspaceCollapseContext,
  useWorkspaceCollapse,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WorkspaceCollapseContext'
import type { WorkspacePathOpener } from '../../../src/shared/types/api'

function CollapseProvider({
  children,
  canRestore = false,
  undoArrange,
}: {
  children: React.ReactNode
  canRestore?: boolean
  undoArrange?: (spaceId: string) => void
}) {
  const defaults = useWorkspaceCollapse()
  const value = React.useMemo(
    () => ({
      ...defaults,
      canUndoArrange: (spaceId: string) => spaceId === 'space-1' && canRestore,
      undoArrange: undoArrange ?? defaults.undoArrange,
    }),
    [defaults, canRestore, undoArrange],
  )
  return (
    <WorkspaceCollapseContext.Provider value={value}>{children}</WorkspaceCollapseContext.Provider>
  )
}

function renderMenu(
  openers: WorkspacePathOpener[],
  options?: {
    canCreateWorktree?: boolean
    canArchive?: boolean
    currentLabelColor?: 'blue'
    closeMenu?: () => void
    canRestore?: boolean
    undoArrange?: (spaceId: string) => void
  },
) {
  render(
    <CollapseProvider canRestore={options?.canRestore} undoArrange={options?.undoArrange}>
      <WorkspaceSpaceActionMenu
        menu={{ spaceId: 'space-1', x: 120, y: 80 }}
        availableOpeners={openers}
        canCreateWorktree={options?.canCreateWorktree ?? false}
        canArchive={options?.canArchive ?? false}
        currentLabelColor={options?.currentLabelColor ?? null}
        closeMenu={options?.closeMenu ?? (() => undefined)}
        setSpaceLabelColor={() => undefined}
        onCreateWorktree={() => undefined}
        onArchive={() => undefined}
        onCopyPath={() => undefined}
        onOpenPath={() => undefined}
      />
    </CollapseProvider>,
  )
}

describe('WorkspaceSpaceActionMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('restores the layout from the Space menu only while a snapshot is available', () => {
    const undoArrange = vi.fn()
    const closeMenu = vi.fn()
    renderMenu([], { canRestore: true, undoArrange, closeMenu })

    fireEvent.click(screen.getByRole('button', { name: 'Restore previous layout' }))

    expect(undoArrange).toHaveBeenCalledWith('space-1')
    expect(closeMenu).toHaveBeenCalledOnce()
  })

  it('omits restore when the Space has no previous layout', () => {
    renderMenu([])

    expect(screen.queryByTestId('workspace-space-undo-arrange-space-1')).not.toBeInTheDocument()
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

  it('keeps keyboard focus on the opener until the submenu is explicitly opened', () => {
    renderMenu([{ id: 'terminal', label: 'Terminal' }])

    const opener = screen.getByTestId('workspace-space-action-open')
    fireEvent.focus(opener)

    expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('workspace-space-action-open-menu')).not.toBeInTheDocument()

    fireEvent.click(opener)

    expect(opener).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('workspace-space-action-open-menu')).toBeVisible()
  })

  it('keeps mobile submenus open after pointer leave and returns without dismissing the root', () => {
    vi.stubGlobal('innerWidth', 390)
    const closeMenu = vi.fn()
    renderMenu([{ id: 'terminal', label: 'Terminal' }], { closeMenu })

    fireEvent.mouseEnter(screen.getByTestId('workspace-space-action-open'))
    expect(screen.queryByTestId('workspace-space-action-open-menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('workspace-space-action-open'))
    const submenu = screen.getByTestId('workspace-space-action-open-menu')
    act(() => {
      fireEvent.mouseEnter(submenu)
      fireEvent.mouseLeave(submenu)
      vi.advanceTimersByTime(400)
    })

    expect(submenu).toBeVisible()
    fireEvent.click(within(submenu).getByRole('button', { name: 'Back' }))

    expect(screen.queryByTestId('workspace-space-action-open-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-space-action-menu')).toBeVisible()
    expect(closeMenu).not.toHaveBeenCalled()
    fireEvent.mouseEnter(screen.getByTestId('workspace-space-action-open'))
    expect(screen.queryByTestId('workspace-space-action-open-menu')).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('workspace-space-action-menu'), { key: 'Escape' })
    expect(closeMenu).toHaveBeenCalledOnce()
  })

  it('can render both create and archive actions together', () => {
    const onCreateWorktree = vi.fn()
    render(
      <WorkspaceSpaceActionMenu
        menu={{ spaceId: 'space-1', x: 120, y: 80 }}
        availableOpeners={[]}
        canCreateWorktree
        canArchive
        closeMenu={() => undefined}
        setSpaceLabelColor={() => undefined}
        onCreateWorktree={onCreateWorktree}
        onArchive={() => undefined}
        onCopyPath={() => undefined}
        onOpenPath={() => undefined}
      />,
    )

    expect(screen.getByTestId('workspace-space-action-create')).toBeVisible()
    expect(screen.getByTestId('workspace-space-action-archive')).toBeVisible()

    const createButton = screen.getByTestId('workspace-space-action-create')
    vi.spyOn(createButton, 'getBoundingClientRect').mockReturnValue({
      x: 120,
      y: 80,
      left: 120,
      top: 80,
      right: 340,
      bottom: 110,
      width: 220,
      height: 30,
      toJSON: () => ({}),
    })
    fireEvent.click(createButton)

    expect(onCreateWorktree).toHaveBeenCalledWith({ x: 120, y: 80 })
  })

  it('toggles the preserve window sizes setting', () => {
    const onChangePreserveWindowSizes = vi.fn()
    render(
      <WorkspaceSpaceActionMenu
        menu={{ spaceId: 'space-1', x: 120, y: 80 }}
        availableOpeners={[]}
        canCreateWorktree={false}
        canArchive={false}
        preserveWindowSizes={false}
        onChangePreserveWindowSizes={onChangePreserveWindowSizes}
        closeMenu={() => undefined}
        setSpaceLabelColor={() => undefined}
        onArrange={() => undefined}
        onCreateWorktree={() => undefined}
        onArchive={() => undefined}
        onCopyPath={() => undefined}
        onOpenPath={() => undefined}
      />,
    )

    fireEvent.click(screen.getByTestId('workspace-space-action-preserve-window-sizes'))

    expect(onChangePreserveWindowSizes).toHaveBeenCalledWith(true)
  })

  it('keeps label colors above the separator and arrange last', () => {
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

    const menu = screen.getByTestId('workspace-space-action-menu')
    const children = Array.from(menu.children)
    const ids = within(menu)
      .getAllByRole('button')
      .map(button => button.getAttribute('data-testid'))

    expect(children[0]).toHaveAttribute('data-testid', 'workspace-space-action-label-color-menu')
    expect(children[1]).toHaveClass('workspace-context-menu__separator')
    expect(ids).toContain('workspace-space-action-label-color-blue')
    expect(ids.at(-1)).toBe('workspace-space-action-arrange')
  })

  it('shows the selected label color check in the swatch center', () => {
    renderMenu([], { currentLabelColor: 'blue' })

    expect(screen.getByTestId('workspace-space-action-label-color-blue')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('workspace-space-action-label-color-green')).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    expect(
      screen.getByTestId('workspace-space-action-label-color-blue').querySelector('svg'),
    ).not.toBeNull()
    expect(
      screen.getByTestId('workspace-space-action-label-color-green').querySelector('svg'),
    ).toBeNull()
  })

  it('does not show the Open submenu when no path openers are available (web)', () => {
    renderMenu([])

    expect(screen.queryByTestId('workspace-space-action-open')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-space-action-copy-path')).toBeVisible()
  })
})
