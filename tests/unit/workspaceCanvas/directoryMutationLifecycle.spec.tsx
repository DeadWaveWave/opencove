import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSystemEntry } from '../../../src/shared/contracts/dto'
import { useSpaceExplorerOverlayMutations } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlay.mutations'
import type { SpaceExplorerClipboardItem } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlay.operations'

const api = vi.hoisted(() => ({
  createDirectory: vi.fn(),
  writeFileText: vi.fn(),
  renameEntry: vi.fn(),
  deleteEntry: vi.fn(),
  moveEntry: vi.fn(),
  copyEntry: vi.fn(),
  readDirectory: vi.fn(),
}))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/mountAwareFilesystemApi',
  () => ({
    resolveFilesystemApiForMount: () => api,
  }),
)

const ROOT = 'file:///project/a'
const NEXT = 'file:///project/b'
const entry: FileSystemEntry = { uri: `${ROOT}/old.md`, name: 'old.md', kind: 'file' }
const nextEntry: FileSystemEntry = { uri: `${NEXT}/next.md`, name: 'next.md', kind: 'file' }

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(clipboard: SpaceExplorerClipboardItem | null = null) {
  const effects = {
    setExplorerClipboard: vi.fn(),
    closeContextMenu: vi.fn(),
    onShowMessage: vi.fn(),
    selectEntry: vi.fn(),
    refresh: vi.fn(),
    setExpandedDirectoryUris: vi.fn(),
    setDropTargetDirectoryUri: vi.fn(),
  }
  const initialProps = { rootUri: ROOT, mountId: null as string | null, clipboard }
  const hook = renderHook(
    ({ rootUri, mountId, clipboard: currentClipboard }) =>
      useSpaceExplorerOverlayMutations({
        t: key => key,
        rootUri,
        mountId,
        explorerClipboard: currentClipboard,
        directoryListings: {},
        entriesByUri: new Map([
          [entry.uri, entry],
          [nextEntry.uri, nextEntry],
        ]),
        selectedEntryUri: rootUri === ROOT ? entry.uri : nextEntry.uri,
        selectedEntryKind: 'file',
        ensureEntryMutable: () => true,
        draggedEntryUri: entry.uri,
        ...effects,
      }),
    { initialProps },
  )
  const navigate = (rootUri = NEXT, mountId: string | null = null) => {
    hook.rerender({ rootUri, mountId, clipboard })
    effects.selectEntry.mockClear()
    effects.refresh.mockClear()
    effects.setExpandedDirectoryUris.mockClear()
  }
  return { ...hook, effects, navigate }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.readDirectory.mockResolvedValue({ entries: [] })
})

describe('directory mutation scope', () => {
  it.each(['directory', 'mount', 'return'] as const)(
    'does not let a pending create reset a new form after a %s change',
    async transition => {
      const old = deferred()
      const current = deferred()
      api.createDirectory.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
      const view = setup()
      act(() => view.result.current.create.start('directory'))
      act(() => view.result.current.create.setDraftName('old-folder'))
      let pending!: Promise<void>
      act(() => {
        pending = view.result.current.create.submit()
      })
      expect(view.result.current.create.isCreating).toBe(true)
      if (transition === 'mount') {
        view.navigate(ROOT, 'remote')
      } else {
        view.navigate()
      }
      if (transition === 'return') {
        view.navigate(ROOT)
      }
      expect(view.result.current.create).toMatchObject({
        mode: null,
        draftName: '',
        isCreating: false,
      })
      act(() => view.result.current.create.start('directory'))
      act(() => view.result.current.create.setDraftName('current-folder'))
      let currentPending!: Promise<void>
      act(() => {
        currentPending = view.result.current.create.submit()
      })
      await act(async () => {
        old.resolve()
        await pending
      })
      expect(view.result.current.create).toMatchObject({
        mode: 'directory',
        draftName: 'current-folder',
        isCreating: true,
      })
      expect(view.effects.selectEntry).not.toHaveBeenCalled()
      expect(view.effects.refresh).not.toHaveBeenCalled()
      expect(view.effects.setExpandedDirectoryUris).not.toHaveBeenCalled()
      await act(async () => {
        current.resolve()
        await currentPending
      })
      expect(view.result.current.create.mode).toBeNull()
      expect(view.effects.selectEntry).toHaveBeenCalledOnce()
      expect(view.effects.refresh).toHaveBeenCalledOnce()
    },
  )

  it('keeps a new rename draft and clears consumed cut clipboard when an old rename completes', async () => {
    const old = deferred()
    api.renameEntry.mockReturnValueOnce(old.promise)
    const view = setup({ mode: 'cut', entry })
    act(() => view.result.current.rename.start(entry))
    act(() => view.result.current.rename.setDraftName('renamed.md'))
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.rename.submit()
    })
    view.navigate()
    expect(view.result.current.rename).toMatchObject({
      entryUri: null,
      draftName: '',
      isRenaming: false,
    })
    act(() => view.result.current.rename.start(nextEntry))
    act(() => view.result.current.rename.setDraftName('new-draft.md'))
    view.effects.selectEntry.mockClear()
    await act(async () => {
      old.resolve()
      await pending
    })
    expect(view.result.current.rename).toMatchObject({
      entryUri: nextEntry.uri,
      draftName: 'new-draft.md',
      isRenaming: false,
    })
    expect(view.effects.setExplorerClipboard).toHaveBeenCalledExactlyOnceWith(null)
    expect(view.effects.selectEntry).not.toHaveBeenCalled()
    expect(view.effects.refresh).not.toHaveBeenCalled()
  })

  it('reports stale mutation errors without attaching them to a new directory form', async () => {
    const old = deferred()
    api.renameEntry.mockReturnValue(old.promise)
    const view = setup()
    act(() => view.result.current.rename.start(entry))
    act(() => view.result.current.rename.setDraftName('denied.md'))
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.rename.submit()
    })
    view.navigate()
    act(() => view.result.current.create.start('file'))
    await act(async () => {
      old.reject(new Error('Access denied'))
      await pending
    })
    expect(view.result.current.rename.error).toBeNull()
    expect(view.result.current.create).toMatchObject({ mode: 'file', error: null })
    expect(view.effects.onShowMessage).toHaveBeenCalledExactlyOnceWith('Access denied', 'error')
  })

  it('clears delete confirmation on navigation and does not clear the new directory selection', async () => {
    const old = deferred()
    api.deleteEntry.mockReturnValue(old.promise)
    const view = setup({ mode: 'cut', entry })
    act(() => view.result.current.requestDeleteSelection())
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.confirmDelete()
    })
    view.navigate()
    expect(view.result.current.deleteConfirmation).toBeNull()
    await act(async () => {
      old.resolve()
      await pending
    })
    expect(view.effects.setExplorerClipboard).toHaveBeenCalledExactlyOnceWith(null)
    expect(view.effects.selectEntry).not.toHaveBeenCalled()
    expect(view.effects.refresh).not.toHaveBeenCalled()
  })

  it('ignores create UI completion after the directory window unmounts', async () => {
    const old = deferred()
    api.writeFileText.mockReturnValue(old.promise)
    const view = setup()
    act(() => view.result.current.create.start('file'))
    act(() => view.result.current.create.setDraftName('created.md'))
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.create.submit()
    })
    view.unmount()
    await act(async () => {
      old.resolve()
      await pending
    })
    expect(view.effects.selectEntry).not.toHaveBeenCalled()
    expect(view.effects.refresh).not.toHaveBeenCalled()
  })
})

describe('directory move history scope', () => {
  it('preserves a completed move and clipboard result without adding history or selection to the new directory', async () => {
    const old = deferred()
    api.moveEntry.mockReturnValue(old.promise)
    const view = setup({ mode: 'cut', entry })
    act(() => view.result.current.requestDropMove(NEXT))
    expect(api.moveEntry).toHaveBeenCalledOnce()
    view.navigate()
    await act(async () => {
      old.resolve()
      await old.promise
      await Promise.resolve()
    })
    expect(view.effects.setExplorerClipboard).toHaveBeenCalledExactlyOnceWith(null)
    expect(view.effects.selectEntry).not.toHaveBeenCalled()
    expect(view.effects.refresh).not.toHaveBeenCalled()
    expect(view.result.current.canUndoMove).toBe(false)
    expect(view.result.current.canRedoMove).toBe(false)
  })

  it('resets existing move history when changing directories', async () => {
    api.moveEntry.mockResolvedValue(undefined)
    const clipboard: SpaceExplorerClipboardItem = { mode: 'cut', entry }
    const view = setup(clipboard)
    await act(async () => {
      view.result.current.requestDropMove(NEXT)
      await Promise.resolve()
    })
    expect(view.result.current.canUndoMove).toBe(true)
    view.navigate()
    expect(view.result.current.canUndoMove).toBe(false)
    expect(view.result.current.canRedoMove).toBe(false)
  })

  it('does not erase a newer clipboard when the old rename finishes', async () => {
    const old = deferred()
    api.renameEntry.mockReturnValue(old.promise)
    const view = setup({ mode: 'cut', entry })
    act(() => view.result.current.rename.start(entry))
    act(() => view.result.current.rename.setDraftName('renamed.md'))
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.rename.submit()
    })
    view.rerender({ rootUri: ROOT, mountId: null, clipboard: { mode: 'copy', entry } })
    view.effects.setExplorerClipboard.mockClear()
    await act(async () => {
      old.resolve()
      await pending
    })
    expect(view.effects.setExplorerClipboard).not.toHaveBeenCalled()
  })

  it('does not start a copy after its old directory preflight finishes', async () => {
    const listing = deferred<{ entries: FileSystemEntry[] }>()
    api.readDirectory.mockReturnValue(listing.promise)
    const view = setup({ mode: 'copy', entry })
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.pasteIntoSelectionTarget()
    })
    view.navigate()
    await act(async () => {
      listing.resolve({ entries: [] })
      await pending
    })
    expect(api.copyEntry).not.toHaveBeenCalled()
    expect(view.effects.selectEntry).not.toHaveBeenCalled()
  })

  it('still reports a failed move after leaving its directory', async () => {
    const old = deferred()
    api.moveEntry.mockReturnValue(old.promise)
    const view = setup()
    act(() => view.result.current.requestDropMove(NEXT))
    view.navigate()
    await act(async () => {
      old.reject(new Error('Move refused'))
      await Promise.resolve()
    })
    expect(view.effects.onShowMessage).toHaveBeenCalledExactlyOnceWith('Move refused', 'error')
    expect(view.result.current.canUndoMove).toBe(false)
  })
})
