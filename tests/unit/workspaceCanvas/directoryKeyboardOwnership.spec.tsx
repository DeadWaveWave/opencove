import React from 'react'
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceSpaceExplorerOverlayKeyboard } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlay.keyboard'
import { WorkspaceSpaceExplorerOverlayHeader } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlayHeader'
import { WorkspaceDirectoryBrowserNavigation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceDirectoryBrowserNavigation'

vi.mock('../../../src/app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function setup() {
  const actions = {
    moveSelection: vi.fn(),
    collapseSelectionOrFocusParent: vi.fn(),
    expandSelectionOrOpen: vi.fn(),
    openSelection: vi.fn(),
    requestDeleteSelection: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    copyPath: vi.fn(async () => {}),
    undoMove: vi.fn(async () => {}),
    redoMove: vi.fn(async () => {}),
    pasteIntoSelectionTarget: vi.fn(async () => {}),
    startRenameSelection: vi.fn(),
    focusFilterInput: vi.fn(),
    openKeyboardContextMenu: vi.fn(),
    onClose: vi.fn(),
  }
  const onViewModeChange = vi.fn()
  const onNavigate = vi.fn()
  function Harness() {
    const rootRef = React.useRef<HTMLDivElement | null>(null)
    useWorkspaceSpaceExplorerOverlayKeyboard({
      rootRef,
      contextMenu: null,
      dismissTransientUi: () => false,
      canUndoMove: false,
      canRedoMove: false,
      ...actions,
    })
    return (
      <div ref={rootRef}>
        <WorkspaceSpaceExplorerOverlayHeader
          title="source"
          viewMode="icons"
          onViewModeChange={onViewModeChange}
          onWindowDragStart={vi.fn()}
          onClose={actions.onClose}
        />
        <div role="tree" tabIndex={0} aria-label="Files" />
        <WorkspaceDirectoryBrowserNavigation
          rootUri="file:///project"
          currentUri="file:///project/docs"
          onNavigate={onNavigate}
        />
        <a href="#folder">Folder link</a>
        <span role="button" tabIndex={0}>
          Custom action
        </span>
      </div>
    )
  }
  render(<Harness />)
  return { actions, onNavigate, onViewModeChange }
}

function press(target: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) {
  act(() => target.focus())
  const event = createEvent.keyDown(target, { key, ...modifiers })
  fireEvent(target, event)
  return event
}

describe('directory keyboard ownership', () => {
  it('leaves header and footer Enter activation to their native buttons', () => {
    const { actions, onNavigate, onViewModeChange } = setup()
    const view = screen.getByRole('radio', { name: 'spaceExplorer.listView' })
    const root = within(screen.getByRole('navigation')).getByRole('button', { name: 'project' })
    const close = screen.getByRole('button', { name: 'common.close' })
    for (const button of [view, root, close]) {
      expect(press(button, 'Enter').defaultPrevented).toBe(false)
      // Happy DOM does not synthesize the browser's default Enter click.
      fireEvent.click(button)
    }
    expect(onViewModeChange).toHaveBeenCalledExactlyOnceWith('list')
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledWith('file:///project')
    expect(actions.onClose).toHaveBeenCalledOnce()
    expect(actions.openSelection).not.toHaveBeenCalled()
  })

  it('does not route ordinary control keys to a stale file selection', () => {
    const { actions } = setup()
    const targets = [
      screen.getByRole('radio', { name: 'spaceExplorer.listView' }),
      screen.getByRole('link', { name: 'Folder link' }),
      screen.getByRole('button', { name: 'Custom action' }),
    ]
    for (const target of targets) {
      for (const key of ['Enter', 'ArrowDown', 'ArrowLeft', 'Home', 'Delete', 'F2']) {
        expect(press(target, key).defaultPrevented).toBe(false)
      }
    }
    expect(actions.openSelection).not.toHaveBeenCalled()
    expect(actions.moveSelection).not.toHaveBeenCalled()
    expect(actions.requestDeleteSelection).not.toHaveBeenCalled()
    expect(actions.startRenameSelection).not.toHaveBeenCalled()
  })

  it('keeps global chords on controls and normal navigation on the file tree', () => {
    const { actions } = setup()
    const control = screen.getByRole('radio', { name: 'spaceExplorer.listView' })
    expect(press(control, 'f', { metaKey: true }).defaultPrevented).toBe(true)
    expect(press(control, 'c', { metaKey: true }).defaultPrevented).toBe(true)
    expect(press(control, 'Escape').defaultPrevented).toBe(true)
    expect(actions.focusFilterInput).toHaveBeenCalledOnce()
    expect(actions.copySelection).toHaveBeenCalledOnce()
    expect(actions.onClose).toHaveBeenCalledOnce()
    const tree = screen.getByRole('tree')
    expect(press(tree, 'ArrowDown').defaultPrevented).toBe(true)
    expect(press(tree, 'Enter').defaultPrevented).toBe(true)
    expect(actions.moveSelection).toHaveBeenCalledExactlyOnceWith('next')
    expect(actions.openSelection).toHaveBeenCalledOnce()
  })
})
