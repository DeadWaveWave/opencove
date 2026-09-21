import React, { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import type { ContextMenuState } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import { WindowCollapsePresentation } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WindowCollapsePresentation'
import { WindowCollapseButton } from '@contexts/workspace/presentation/renderer/components/shared/WindowCollapseButton'
import { WindowNodeContextMenuProvider } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WindowNodeContextMenuContext'
import { WorkspaceContextSelectionMenuContent } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceContextMenuSelectionParts'
import { WorkspaceCollapseContext } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WorkspaceCollapseContext'

describe('collapsed node context menu', () => {
  function setup(dirty = false) {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    const toggleNode = vi.fn()
    const closeOtherMenus = vi.fn()
    const createSpace = vi.fn()
    function Canvas() {
      const [menu, setMenu] = useState<ContextMenuState | null>(null)
      return (
        <WindowNodeContextMenuProvider setContextMenu={setMenu} closeOtherMenus={closeOtherMenus}>
          <WorkspaceCollapseContext
            value={{
              workspaceId: 'workspace',
              nodes: [],
              spaces: [],
              collapsedNodeIds: { note: true },
              collapsedSpaceIds: {},
              toggleNode,
              revealNode: vi.fn(),
              collapseAndArrange: vi.fn(),
              undoArrange: vi.fn(),
              canUndoArrange: () => false,
            }}
          >
            <WindowCollapsePresentation
              id="note"
              onSelect={onSelect}
              data={
                {
                  kind: 'note',
                  title: 'Draft',
                  width: 500,
                  height: 400,
                  collapsePresentation: { collapsed: true, spaceHidden: false },
                } as TerminalNodeData
              }
            >
              <WindowCollapseButton onClose={onClose} revealBeforeClose={dirty} />
              <textarea aria-label="Draft" defaultValue="unsaved text" />
            </WindowCollapsePresentation>
            {menu?.kind === 'selection' ? (
              <div role="menu">
                <WorkspaceContextSelectionMenuContent
                  createSpaceFromSelectedNodes={createSpace}
                  openLabelColorSubmenu={vi.fn()}
                  labelColorButtonRef={{ current: null }}
                  isLabelColorSubmenuOpen={false}
                  canConvertSelectedNoteToTask
                  isConvertSelectedNoteToTaskDisabled={false}
                  convertSelectedNoteToTask={vi.fn()}
                  clearNodeSelection={vi.fn()}
                  closeContextMenu={() => setMenu(null)}
                  closeWindow={menu.closeWindow}
                />
              </div>
            ) : null}
          </WorkspaceCollapseContext>
        </WindowNodeContextMenuProvider>
      )
    }
    const view = render(<Canvas />)
    return { ...view, onClose, onSelect, toggleNode, closeOtherMenus, createSpace }
  }

  it('opens the shared node menu without expanding or remounting its runtime, then exits through its owner', () => {
    const { container, onClose, onSelect, toggleNode, closeOtherMenus } = setup()
    const editor = container.querySelector('textarea')
    fireEvent.contextMenu(screen.getByTestId('node-expand'), { clientX: 40, clientY: 60 })
    expect(onSelect).toHaveBeenCalledOnce()
    expect(closeOtherMenus).toHaveBeenCalledOnce()
    expect(screen.getByTestId('workspace-selection-create-space')).toBeVisible()
    expect(screen.getByTestId('workspace-selection-convert-note-to-task')).toBeVisible()
    expect(screen.getByTestId('workspace-selection-label-color')).toBeVisible()
    expect(toggleNode).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBe(editor)
    const close = screen.getByTestId('workspace-node-close')
    expect(screen.getByRole('menu').lastElementChild).toBe(close)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
    expect(toggleNode).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps dirty data untouched on right-click and reveals the existing close prompt only on Close', () => {
    const { container, onClose, toggleNode } = setup(true)
    fireEvent.keyDown(screen.getByTestId('node-expand'), { key: 'F10', shiftKey: true })
    expect(toggleNode).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toHaveValue('unsaved text')
    fireEvent.click(screen.getByTestId('workspace-node-close'))
    expect(toggleNode).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expect(toggleNode.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0])
  })
})
