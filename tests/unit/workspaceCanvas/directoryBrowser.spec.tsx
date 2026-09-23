import React from 'react'
import {
  act,
  createEvent,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSystemEntry } from '../../../src/shared/contracts/dto'
import { WorkspaceDirectoryBrowser } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceDirectoryBrowser'
import {
  useDirectoryExpansion,
  useDirectoryListings,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceDirectoryBrowser.listings'
import { WorkspaceDirectoryViewMode } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceDirectoryViewMode'
import { FILESYSTEM_ENTRY_MIME } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/filesystemDrag'

vi.mock('../../../src/app/renderer/i18n', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

const rootUri = 'file:///project'
const docsUri = `${rootUri}/docs`
const designUri = `${docsUri}/design`
const readDirectory = vi.fn()
const writeText = vi.fn()
const onOpenFile = vi.fn()
const onPreviewFile = vi.fn()
const noop = () => undefined
const noBlock = () => null
const files: Record<string, FileSystemEntry[]> = {
  [rootUri]: [
    { uri: `${rootUri}/file10.md`, name: 'file10.md', kind: 'file' },
    { uri: `${rootUri}/src`, name: 'src', kind: 'directory' },
    { uri: `${rootUri}/file2.md`, name: 'file2.md', kind: 'file' },
    { uri: docsUri, name: 'docs', kind: 'directory' },
  ],
  [docsUri]: [
    { uri: designUri, name: 'design', kind: 'directory' },
    { uri: `${docsUri}/guide.md`, name: 'guide.md', kind: 'file' },
  ],
  [designUri]: [{ uri: `${designUri}/theme.json`, name: 'theme.json', kind: 'file' }],
}

function Harness({
  initialUri = rootUri,
  initialView = 'icons',
}: {
  initialUri?: string
  initialView?: 'icons' | 'list'
}) {
  const [currentUri, navigate] = React.useState(initialUri)
  const [viewMode, changeView] = React.useState(initialView)
  const [expanded, changeExpanded] = React.useState<string[]>([])
  const [clipboard, setClipboard] =
    React.useState<Parameters<typeof WorkspaceDirectoryBrowser>[0]['explorerClipboard']>(null)
  const ref = React.useRef<HTMLDivElement | null>(null)
  const createRef = React.useRef<HTMLInputElement | null>(null)
  const renameRef = React.useRef<HTMLInputElement | null>(null)
  return (
    <div ref={ref} tabIndex={0} data-testid="browser-container">
      <output data-testid="current-uri">{currentUri}</output>
      <WorkspaceDirectoryViewMode viewMode={viewMode} onViewModeChange={changeView} />
      <WorkspaceDirectoryBrowser
        spaceId="source"
        sourceSpaceId="space-a"
        rootUri={rootUri}
        currentUri={currentUri}
        viewMode={viewMode}
        expandedDirectoryUris={expanded}
        onNavigate={navigate}
        onExpandedDirectoryUrisChange={changeExpanded}
        mountId={null}
        rootResolveError={null}
        explorerClipboard={clipboard}
        setExplorerClipboard={setClipboard}
        findBlockingOpenDocument={noBlock}
        onPreviewFile={onPreviewFile}
        onOpenFile={onOpenFile}
        onDismissQuickPreview={noop}
        onClose={noop}
        createInputRef={createRef}
        renameInputRef={renameRef}
        containerRef={ref}
      />
    </div>
  )
}

function entry(uri: string) {
  return screen.getByTestId(`workspace-space-explorer-entry-source-${encodeURIComponent(uri)}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  readDirectory.mockImplementation(async ({ uri }: { uri: string }) => ({
    entries: files[uri] ?? [],
  }))
  writeText.mockResolvedValue(undefined)
  window.opencoveApi = {
    filesystem: { readDirectory },
    clipboard: { writeText },
  } as unknown as Window['opencoveApi']
})

describe('directory browser', () => {
  it('sorts icon cells by folder then natural filename and follows clickable slash breadcrumbs', async () => {
    render(<Harness />)
    await screen.findAllByRole('option')
    expect(screen.getAllByRole('option').map(item => item.textContent)).toEqual([
      'docs',
      'src',
      'file2.md',
      'file10.md',
    ])
    const body = document.querySelector('.cove-directory-browser')
    const footer = screen.getByRole('navigation', { name: 'spaceExplorer.path' })
    const tree = screen.getByTestId('workspace-space-explorer-tree')
    tree.scrollTop = 240
    fireEvent.click(entry(docsUri))
    await waitFor(() => expect(screen.getByTestId('current-uri')).toHaveTextContent(docsUri))
    expect(document.querySelector('.cove-directory-browser')).toBe(body)
    expect(screen.getByRole('navigation', { name: 'spaceExplorer.path' })).toBe(footer)
    expect(screen.getByTestId('workspace-space-explorer-tree')).toBe(tree)
    expect(tree.scrollTop).toBe(0)
    await screen.findByText('design')
    fireEvent.click(entry(designUri))
    await screen.findByText('theme.json')
    const nav = screen.getByRole('navigation', { name: 'spaceExplorer.path' })
    expect(nav.textContent).toBe('project/docs/design')
    fireEvent.click(within(nav).getByRole('button', { name: 'docs' }))
    await waitFor(() => expect(screen.getByTestId('current-uri').textContent).toBe(docsUri))
    fireEvent.click(within(nav).getByRole('button', { name: 'project' }))
    await waitFor(() => expect(screen.getByTestId('current-uri').textContent).toBe(rootUri))
    expect(screen.queryByRole('button', { name: 'spaceExplorer.parentFolder' })).toBeNull()
  })

  it('toggles list folders from their row or disclosure without navigating and retains expansion across view switches', async () => {
    render(<Harness initialView="list" />)
    await screen.findAllByRole('treeitem')
    fireEvent.click(entry(docsUri))
    await screen.findByText('design')
    expect(screen.getByTestId('current-uri').textContent).toBe(rootUri)
    expect(entry(docsUri)).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(entry(docsUri))
    expect(screen.queryByText('design')).toBeNull()
    expect(entry(docsUri)).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(within(entry(docsUri)).getByTestId('directory-entry-disclosure'))
    expect(screen.getByText('design')).toBeVisible()
    expect(entry(docsUri)).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.iconsView' }))
    expect(screen.queryByText('design')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.listView' }))
    expect(screen.getByText('design')).toBeVisible()
    fireEvent.click(entry(designUri))
    await screen.findByText('theme.json')
    expect(screen.getByTestId('current-uri').textContent).toBe(rootUri)
    fireEvent.doubleClick(entry(designUri))
    await waitFor(() => expect(screen.getByTestId('current-uri').textContent).toBe(designUri))
    expect(screen.getByRole('button', { name: 'spaceExplorer.listView' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('explicitly enters a list folder through its context menu', async () => {
    render(<Harness initialView="list" />)
    await screen.findAllByRole('treeitem')
    fireEvent.contextMenu(entry(docsUri), { clientX: 30, clientY: 40 })
    fireEvent.click(await screen.findByRole('button', { name: 'spaceActions.open' }))
    await waitFor(() => expect(screen.getByTestId('current-uri').textContent).toBe(docsUri))
    await screen.findByText('design')
  })

  it('uses Enter to enter a selected folder while ArrowRight expands the list', async () => {
    render(<Harness initialView="list" />)
    await screen.findAllByRole('treeitem')
    screen.getByTestId('browser-container').focus()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await screen.findByText('design')
    expect(screen.getByTestId('current-uri').textContent).toBe(rootUri)
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('current-uri').textContent).toBe(docsUri))
  })

  it('exports references from either view without moving files and preserves the navigation boundary', async () => {
    render(<Harness initialUri={docsUri} />)
    await screen.findAllByRole('option')
    const setData = vi.fn()
    const transfer = { setData, effectAllowed: 'none' }
    const drag = createEvent.dragStart(entry(designUri))
    Object.defineProperty(drag, 'dataTransfer', { value: transfer })
    fireEvent(entry(designUri), drag)
    expect(setData).toHaveBeenCalledWith(
      FILESYSTEM_ENTRY_MIME,
      JSON.stringify({
        version: 1,
        uri: designUri,
        kind: 'directory',
        rootUri,
        mountId: null,
        sourceSpaceId: 'space-a',
      }),
    )
    expect(transfer.effectAllowed).toBe('copyMove')
    fireEvent.dragEnd(entry(designUri), { dataTransfer: transfer })
    expect(readDirectory).toHaveBeenCalledTimes(1)
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('copies paths relative to the project rather than the current directory', async () => {
    render(<Harness initialUri={docsUri} />)
    await screen.findAllByRole('option')
    fireEvent.contextMenu(entry(`${docsUri}/guide.md`), { clientX: 30, clientY: 40 })
    fireEvent.click(await screen.findByRole('button', { name: 'spaceExplorer.copyRelativePath' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('docs/guide.md'))
  })

  it('keeps the newly created and renamed entry selected while its directory refreshes', async () => {
    const listing = [...files[docsUri]]
    readDirectory.mockImplementation(async () => ({ entries: [...listing] }))
    Object.assign(window.opencoveApi.filesystem, {
      writeFileText: vi.fn(async ({ uri }: { uri: string }) => {
        listing.push({ uri, name: uri.split('/').at(-1) ?? '', kind: 'file' })
      }),
      renameEntry: vi.fn(
        async ({ sourceUri, targetUri }: { sourceUri: string; targetUri: string }) => {
          const index = listing.findIndex(item => item.uri === sourceUri)
          if (index >= 0) {
            listing[index] = {
              ...listing[index],
              uri: targetUri,
              name: targetUri.split('/').at(-1) ?? '',
            }
          }
        },
      ),
    })
    render(<Harness initialUri={docsUri} initialView="list" />)
    await screen.findAllByRole('treeitem')
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.newFile' }))
    const input = await screen.findByRole('textbox', { name: 'spaceExplorer.fileNamePlaceholder' })
    fireEvent.change(input, { target: { value: 'created.md' } })
    fireEvent.submit(input.closest('form')!)
    const created = await screen.findByTestId(
      `workspace-space-explorer-entry-source-${encodeURIComponent(`${docsUri}/created.md`)}`,
    )
    await waitFor(() => expect(created).toHaveAttribute('aria-selected', 'true'))

    fireEvent.contextMenu(created, { clientX: 30, clientY: 40 })
    fireEvent.click(await screen.findByRole('button', { name: 'spaceExplorer.rename' }))
    const renameInput = await screen.findByRole('textbox', { name: 'spaceExplorer.rename' })
    fireEvent.change(renameInput, { target: { value: 'renamed.md' } })
    fireEvent.submit(renameInput.closest('form')!)
    const renamed = await screen.findByTestId(
      `workspace-space-explorer-entry-source-${encodeURIComponent(`${docsUri}/renamed.md`)}`,
    )
    await waitFor(() => expect(renamed).toHaveAttribute('aria-selected', 'true'))
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.refresh' }))
    await waitFor(() =>
      expect(entry(`${docsUri}/renamed.md`)).toHaveAttribute('aria-selected', 'true'),
    )
  })
})

describe('directory listing ownership', () => {
  it('ignores an older read after switching directories', async () => {
    let finishOld: ((value: { entries: FileSystemEntry[] }) => void) | undefined
    readDirectory.mockImplementation(({ uri }: { uri: string }) =>
      uri === rootUri
        ? new Promise(resolve => {
            finishOld = resolve
          })
        : Promise.resolve({ entries: files[docsUri] }),
    )
    const expandedDirectoryUris = new Set<string>()
    const { result, rerender } = renderHook(
      ({ uri }) =>
        useDirectoryListings({
          rootUri: uri,
          mountId: null,
          expandedDirectoryUris,
        }),
      { initialProps: { uri: rootUri } },
    )
    rerender({ uri: docsUri })
    await waitFor(() => expect(result.current.directoryListings[docsUri]?.isLoading).toBe(false))
    await act(async () => {
      finishOld?.({ entries: files[rootUri] })
      await Promise.resolve()
    })
    expect(result.current.directoryListings[rootUri]).toBeUndefined()
    expect(result.current.directoryListings[docsUri]?.entries).toHaveLength(2)
  })

  it('does not publish identical controlled expansion state', () => {
    const onExpandedUrisChange = vi.fn()
    const { result } = renderHook(() =>
      useDirectoryExpansion({
        rootUri,
        expandedUris: [docsUri],
        onExpandedUrisChange,
      }),
    )
    act(() => result.current[1](new Set([docsUri])))
    expect(onExpandedUrisChange).not.toHaveBeenCalled()
    act(() => result.current[1](previous => new Set(previous).add(designUri)))
    expect(onExpandedUrisChange).toHaveBeenCalledExactlyOnceWith([docsUri, designUri])
  })
})
