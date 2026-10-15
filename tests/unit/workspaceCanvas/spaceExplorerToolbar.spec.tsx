import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceSpaceExplorerOverlayHeader } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlayHeader'
import { WorkspaceSpaceExplorerOverlayToolbar } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlayToolbar'

vi.mock('../../../src/app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderToolbar(query = '') {
  const onCanvasPointerDown = vi.fn()
  const onClearQuery = vi.fn()
  const onQueryChange = vi.fn()
  const onCreateFile = vi.fn()
  const onCreateFolder = vi.fn()
  const onCollapseAll = vi.fn()
  const onRefresh = vi.fn()
  const props = {
    query,
    inputRef: React.createRef<HTMLInputElement>(),
    hasRootError: false,
    onClearQuery,
    onQueryChange,
    onCreateFile,
    onCreateFolder,
    onCollapseAll,
    onRefresh,
  }
  const view = render(
    <div onPointerDown={onCanvasPointerDown}>
      <WorkspaceSpaceExplorerOverlayToolbar {...props} />
    </div>,
  )
  return { ...view, props, onCanvasPointerDown }
}

describe('space explorer chrome', () => {
  it('keeps view switching and closing out of the header drag gesture', () => {
    const onWindowDragStart = vi.fn()
    const onClose = vi.fn()
    const onViewModeChange = vi.fn()
    const { container } = render(
      <WorkspaceSpaceExplorerOverlayHeader
        title="Source workspace"
        viewMode="icons"
        onViewModeChange={onViewModeChange}
        onWindowDragStart={onWindowDragStart}
        onClose={onClose}
      />,
    )
    const icons = screen.getByRole('radio', { name: 'spaceExplorer.iconsView' })
    const list = screen.getByRole('radio', { name: 'spaceExplorer.listView' })
    const close = screen.getByRole('button', { name: 'common.close' })
    expect(icons).toBeChecked()
    expect(list).not.toBeChecked()
    fireEvent.pointerDown(list)
    fireEvent.click(list)
    expect(onViewModeChange).toHaveBeenCalledExactlyOnceWith('list')
    fireEvent.pointerDown(close)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
    expect(onWindowDragStart).not.toHaveBeenCalled()
    expect(screen.getAllByRole('radio')).toEqual([icons, list])
    expect(screen.getAllByRole('button')).toEqual([close])
    expect(container.querySelector('.workspace-space-explorer__title')).toHaveTextContent(
      'Source workspace',
    )
    expect(container.querySelector('.workspace-space-explorer__subtitle')).toBeNull()
    expect(screen.queryByText('spaceActions.files')).toBeNull()
    fireEvent.pointerDown(screen.getByText('Source workspace'))
    expect(onWindowDragStart).toHaveBeenCalledOnce()
  })

  it('keeps search interaction inside the explorer and returns focus after clearing', () => {
    const { props, onCanvasPointerDown } = renderToolbar('readme')
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.filterPlaceholder' }))
    const input = screen.getByRole('textbox')
    fireEvent.pointerDown(input)
    fireEvent.change(input, { target: { value: 'docs' } })
    expect(props.onQueryChange).toHaveBeenCalledWith('docs')
    expect(onCanvasPointerDown).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.clearFilter' }))
    expect(props.onClearQuery).toHaveBeenCalledOnce()
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onClearQuery).toHaveBeenCalledTimes(2)
  })

  it('keeps refresh available when the root fails and routes each action once', () => {
    const { props, rerender } = renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.newFile' }))
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.newFolder' }))
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.collapseAll' }))
    expect(props.onCreateFile).toHaveBeenCalledOnce()
    expect(props.onCreateFolder).toHaveBeenCalledOnce()
    expect(props.onCollapseAll).toHaveBeenCalledOnce()

    rerender(<WorkspaceSpaceExplorerOverlayToolbar {...props} hasRootError />)
    expect(screen.getByRole('button', { name: 'spaceExplorer.newFile' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'spaceExplorer.newFolder' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'spaceExplorer.collapseAll' })).toBeDisabled()
    const refresh = screen.getByRole('button', { name: 'spaceExplorer.refresh' })
    expect(refresh).toBeEnabled()
    fireEvent.click(refresh)
    expect(props.onRefresh).toHaveBeenCalledOnce()
  })
})
