import React from 'react'
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSpaceExplorerOverlayToolbar } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlayToolbar'
import { useWorkspaceSpaceExplorerOverlayKeyboard } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlay.keyboard'
import { shouldFocusCanvasForPointerTarget } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/domTargets'

vi.mock('../../../src/app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let resize: (width: number) => void
const disconnect = vi.fn()

beforeEach(() => {
  disconnect.mockReset()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = width =>
          callback([{ contentRect: { width } } as ResizeObserverEntry], this as ResizeObserver)
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect
    },
  )
})

afterEach(() => vi.unstubAllGlobals())

function setup(initialQuery = '') {
  const inputRef = React.createRef<HTMLInputElement>()
  const onCreateFile = vi.fn()
  const onClose = vi.fn()
  function Harness() {
    const rootRef = React.useRef<HTMLDivElement | null>(null)
    const [query, setQuery] = React.useState(initialQuery)
    useWorkspaceSpaceExplorerOverlayKeyboard({
      rootRef,
      contextMenu: null,
      dismissTransientUi: () => false,
      moveSelection: vi.fn(),
      collapseSelectionOrFocusParent: vi.fn(),
      expandSelectionOrOpen: vi.fn(),
      requestDeleteSelection: vi.fn(),
      copySelection: vi.fn(),
      cutSelection: vi.fn(),
      copyPath: async () => {},
      canUndoMove: false,
      canRedoMove: false,
      undoMove: async () => {},
      redoMove: async () => {},
      pasteIntoSelectionTarget: async () => {},
      startRenameSelection: vi.fn(),
      focusFilterInput: () => {
        inputRef.current?.focus()
        inputRef.current?.select()
      },
      openKeyboardContextMenu: vi.fn(),
      onClose,
    })
    return (
      <div
        ref={rootRef}
        tabIndex={-1}
        onPointerDownCapture={event => {
          if (event.button === 0 && shouldFocusCanvasForPointerTarget(event.target)) {
            rootRef.current?.focus()
          }
        }}
      >
        <div data-cove-focus-scope="file-browser">
          <WorkspaceSpaceExplorerOverlayToolbar
            query={query}
            inputRef={inputRef}
            hasRootError={false}
            onQueryChange={setQuery}
            onClearQuery={() => setQuery('')}
            onCreateFile={onCreateFile}
            onCreateFolder={vi.fn()}
            onCollapseAll={vi.fn()}
            onRefresh={vi.fn()}
          />
        </div>
        <button type="button">Outside</button>
      </div>
    )
  }
  const view = render(<Harness />)
  const search = screen.getByRole('button', { name: 'spaceExplorer.filterPlaceholder' })
  const tools = screen.getByRole('group', { name: 'spaceActions.files' })
  return { ...view, inputRef, search, tools, onCreateFile, onClose }
}

describe('compact directory search toolbar', () => {
  it('starts as an icon and opens on click or programmatic keyboard focus', () => {
    const { inputRef, search } = setup()
    expect(search).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(search)
    expect(search).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox')).toHaveFocus()
    act(() => screen.getByRole('button', { name: 'Outside' }).focus())
    expect(search).toHaveAttribute('aria-expanded', 'false')
    act(() => inputRef.current?.focus())
    expect(search).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('keeps the query active when focus leaves and clears it before Escape closes search', () => {
    const { inputRef, search, onClose } = setup()
    fireEvent.click(search)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'README' } })
    act(() => screen.getByRole('button', { name: 'Outside' }).focus())
    expect(search).toHaveAttribute('aria-expanded', 'false')
    expect(search).toHaveAttribute('data-filter-active', 'true')
    expect(inputRef.current).toHaveValue('README')
    fireEvent.click(search)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(inputRef.current).toHaveValue('')
    expect(search).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(search).toHaveAttribute('aria-expanded', 'false')
    expect(search).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves nested clear icons to the browser focus owner until native button focus and click', () => {
    const { search } = setup('README')
    fireEvent.click(search)
    const input = screen.getByRole('textbox')
    const clear = screen.getByRole('button', { name: 'spaceExplorer.clearFilter' })
    const iconPath = clear.querySelector('path')!
    fireEvent.pointerDown(iconPath, { button: 0 })
    expect(input).toHaveFocus()
    expect(clear).toBeInTheDocument()
    act(() => clear.focus())
    fireEvent.pointerUp(iconPath, { button: 0 })
    fireEvent.click(iconPath)
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(search).toHaveAttribute('aria-expanded', 'true')
  })

  it.each(['metaKey', 'ctrlKey'] as const)(
    'keeps %s+F inside the browser when search is already focused',
    modifier => {
      const { inputRef, search } = setup('README')
      act(() => search.focus())
      const open = createEvent.keyDown(search, { key: 'f', [modifier]: true })
      fireEvent(search, open)
      expect(open.defaultPrevented).toBe(true)
      const input = screen.getByRole('textbox')
      expect(input).toHaveFocus()
      inputRef.current?.setSelectionRange(3, 3)
      const select = createEvent.keyDown(input, { key: 'f', [modifier]: true })
      fireEvent(input, select)
      expect(select.defaultPrevented).toBe(true)
      expect(inputRef.current?.selectionStart).toBe(0)
      expect(inputRef.current?.selectionEnd).toBe(6)
    },
  )

  it('keeps search open while its clear button takes focus', () => {
    const { search } = setup('README')
    fireEvent.click(search)
    const clear = screen.getByRole('button', { name: 'spaceExplorer.clearFilter' })
    act(() => clear.focus())
    expect(search).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(clear)
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('makes tools inert only while narrow search needs the row, then restores them on blur', () => {
    const { search, tools, unmount } = setup()
    act(() => resize(210))
    expect(tools).not.toHaveAttribute('inert')
    fireEvent.click(search)
    expect(tools).toHaveAttribute('inert')
    expect(tools).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button', { name: 'spaceExplorer.newFile' })).toBeNull()
    act(() => resize(380))
    expect(tools).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'spaceExplorer.newFile' })).toBeEnabled()
    act(() => resize(210))
    act(() => screen.getByRole('button', { name: 'Outside' }).focus())
    expect(tools).not.toHaveAttribute('inert')
    expect(tools).toHaveAttribute('aria-hidden', 'false')
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
