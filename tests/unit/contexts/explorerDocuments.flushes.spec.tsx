import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentOf, stubOpencoveApi, WORKSPACE_A as A } from '../../support/agentRuntimeHarness'
import {
  documentNodeAt,
  folderNodeAt,
  LOCAL,
  renderExplorer,
  renderFilesystemNodes,
  renderOpening,
  spaceAt,
} from '../../support/explorerDocumentsHarness'

// The persistence flushes of the filesystem nodes, the document opening and the explorer (#702,
// PR 12): each is requested once, after the last write of its branch, and as often as before. A
// flush is counted with the number of store writes that came before it and the document it saw, so
// one that is dropped, doubled or requested before its write fails. A branch that created nothing
// and flushed nothing before flushes nothing now.

vi.mock('@app/renderer/i18n', () => {
  const translation = { t: (key: string) => key }
  return { useTranslation: () => translation }
})

const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  filesystem: vi.fn(),
  preview: vi.fn(),
}))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/filesystemNodeBinding',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    resolveFilesystemEntryBinding: (...args: unknown[]) => mocks.binding(...args),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/mountAwareFilesystemApi',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    resolveFilesystemApiForMount: (...args: unknown[]) => mocks.filesystem(...args),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceExplorer.helpers',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    resolveSpaceExplorerPreviewDisplay: (...args: unknown[]) => mocks.preview(...args),
  }),
)

const stat = vi.fn()
beforeEach(() => {
  stat.mockReset().mockResolvedValue({ kind: 'file' })
  mocks.binding.mockReset().mockResolvedValue(LOCAL)
  mocks.filesystem.mockReset().mockReturnValue({
    stat,
    readFileBytes: vi.fn(async () => ({ bytes: new Uint8Array(3) })),
  })
  mocks.preview.mockReset().mockResolvedValue({
    kind: 'image',
    naturalWidth: 40,
    naturalHeight: 30,
    size: { width: 300, height: 200 },
  })
  stubOpencoveApi({ workspace: { writeCanvasImage: vi.fn(async () => undefined) } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const FOLDER_URI = 'file:///repo/docs'
const FILE_URI = `${FOLDER_URI}/a.md`
const folder = () => folderNodeAt('folder', FOLDER_URI, 'file:///repo', { x: 50, y: 50 })
const kinds = (workspaceId: string) => documentOf(workspaceId).nodes.map(node => node.data.kind)
const created = (workspaceId: string, kind: string) =>
  documentOf(workspaceId).nodes.find(node => node.data.kind === kind)

describe('the folder update', () => {
  const next = () => ({ ...folder().data.folder!, viewMode: 'list' as const })

  it('flushes once, on the write that changes the folder', () => {
    const { view, harness, flushes } = renderFilesystemNodes({ a: { nodes: [folder()] } })
    harness.notifications.mockClear()

    act(() => {
      view.result.current.actions.updateFolder('folder', next())
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes[0].data.folder?.viewMode).toBe('list')
  })

  it.each([
    { name: 'the node is not in the store', nodes: [], id: 'folder', root: 'file:///repo' },
    { name: 'the node is another one', nodes: [folder()], id: 'other', root: 'file:///repo' },
    { name: 'the root differs', nodes: [folder()], id: 'folder', root: 'file:///elsewhere' },
  ])('writes and flushes nothing when $name', ({ nodes, id, root }) => {
    const { view, harness, flushes } = renderFilesystemNodes({ a: { nodes } })
    harness.notifications.mockClear()

    act(() => {
      view.result.current.actions.updateFolder(id, { ...next(), rootUri: root })
    })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveLength(0)
  })
})

describe('the file opened from a folder node', () => {
  const open = async (view: ReturnType<typeof renderFilesystemNodes>['view']) => {
    await act(async () => {
      view.result.current.actions.openFile('folder', FILE_URI)
      await vi.waitFor(() => expect(stat).toHaveBeenCalled())
    })
  }

  it('flushes once, after the node is created and assigned to its Space', async () => {
    const { view, flushes, harness } = renderFilesystemNodes({
      a: { nodes: [folder()], spaces: [spaceAt('space-a', ['folder'])] },
    })
    harness.notifications.mockClear()

    await open(view)

    await vi.waitFor(() => expect(flushes).toHaveLength(1))
    expect(flushes[0].notificationsBefore).toBe(2)
    const document = flushes[0].document
    const node = document.nodes.find(candidate => candidate.data.kind === 'document')!
    expect(node.data.document?.uri).toBe(FILE_URI)
    expect(document.spaces[0].nodeIds).toContain(node.id)
  })

  it('flushes once, after the node is created, when the folder is on the root canvas', async () => {
    const { view, flushes, harness } = renderFilesystemNodes({ a: { nodes: [folder()] } })
    harness.notifications.mockClear()

    await open(view)

    await vi.waitFor(() => expect(flushes).toHaveLength(1))
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes.map(node => node.data.kind)).toEqual(['folder', 'document'])
  })

  it('flushes nothing when the node store makes no node', async () => {
    const createDocumentNode = vi.fn(() => null)
    const { view, flushes } = renderFilesystemNodes(
      { a: { nodes: [folder()] } },
      { createDocumentNode },
    )

    await act(async () => {
      view.result.current.actions.openFile('folder', FILE_URI)
      await vi.waitFor(() => expect(createDocumentNode).toHaveBeenCalled())
    })

    expect(kinds(A)).toEqual(['folder'])
    expect(flushes).toHaveLength(0)
  })

  it.each([
    {
      name: 'the entry is another kind than the stat says',
      arrange: () => stat.mockResolvedValue({ kind: 'directory' }),
    },
    {
      name: 'the mount has no binding',
      arrange: () => mocks.binding.mockResolvedValue(null),
    },
  ])('flushes nothing when $name', async ({ arrange }) => {
    arrange()
    const { view, flushes } = renderFilesystemNodes({ a: { nodes: [folder()] } })

    await act(async () => {
      view.result.current.actions.openFile('folder', FILE_URI)
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    expect(kinds(A)).toEqual(['folder'])
    expect(flushes).toHaveLength(0)
  })
})

describe('the document opening', () => {
  const request = (spaceId: string | null) => ({
    uri: FILE_URI,
    mountId: null,
    spaceId,
    anchor: { x: 100, y: 100 },
  })

  it('flushes once, after the document is created and assigned to its Space', async () => {
    const { view, flushes, harness } = renderOpening({ a: { spaces: [spaceAt('space-a')] } })
    harness.notifications.mockClear()

    await act(async () => {
      await view.result.current(request('space-a'))
    })

    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(2)
    const document = flushes[0].document
    expect(document.spaces[0].nodeIds).toEqual([document.nodes[0].id])
  })

  it('flushes once, after the document is created, on the root canvas', async () => {
    const { view, flushes, harness } = renderOpening({ a: {} })
    harness.notifications.mockClear()

    await act(async () => {
      await view.result.current(request(null))
    })

    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes).toHaveLength(1)
  })

  it('flushes nothing when it reuses a document that is already open', async () => {
    const { view, flushes, harness } = renderOpening({
      a: { nodes: [documentNodeAt('doc', FILE_URI)] },
    })
    harness.notifications.mockClear()

    await act(async () => {
      await view.result.current(request(null))
    })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveLength(0)
  })

  it('flushes nothing when the node store makes no node', async () => {
    const createDocumentNode = vi.fn(() => null)
    const { view, flushes } = renderOpening({ a: {} }, { createDocumentNode })

    await act(async () => {
      await view.result.current(request(null))
    })

    expect(createDocumentNode).toHaveBeenCalledOnce()
    expect(flushes).toHaveLength(0)
  })

  it('flushes nothing when no binding can be resolved', async () => {
    mocks.binding.mockResolvedValue(null)
    const { view, flushes } = renderOpening({ a: {} })

    await act(async () => {
      await view.result.current(request(null))
    })

    expect(flushes).toHaveLength(0)
  })
})

describe('the image materialized by the explorer', () => {
  const IMAGE_URI = 'file:///repo/picture.png'

  it('flushes once, after the image node is created and assigned to its Space', async () => {
    const { view, flushes, harness } = renderExplorer({ a: { spaces: [spaceAt('space-a')] } })
    harness.notifications.mockClear()

    await act(async () => {
      view.result.current.openFileInSpace('space-a', IMAGE_URI)
      await vi.waitFor(() => expect(flushes).toHaveLength(1))
    })

    const document = flushes[0].document
    const image = document.nodes.find(node => node.data.kind === 'image')!
    expect(image).toBeDefined()
    expect(document.spaces[0].nodeIds).toContain(image.id)
    expect(flushes[0].notificationsBefore).toBe(2)
    expect(created(A, 'image')).toBeDefined()
  })

  it('flushes nothing when the image cannot be read', async () => {
    mocks.filesystem.mockReturnValue({ readFileBytes: undefined })
    const { view, flushes } = renderExplorer({ a: { spaces: [spaceAt('space-a')] } })

    await act(async () => {
      view.result.current.openFileInSpace('space-a', IMAGE_URI)
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    expect(kinds(A)).toEqual([])
    expect(flushes).toHaveLength(0)
  })

  it('flushes once for the document that the explorer opens through the shared opening', async () => {
    mocks.preview.mockResolvedValue({
      kind: 'document',
      naturalWidth: undefined,
      naturalHeight: undefined,
      size: { width: 300, height: 200 },
    })
    const { view, flushes } = renderExplorer({ a: { spaces: [spaceAt('space-a')] } })

    await act(async () => {
      view.result.current.openFileInSpace('space-a', FILE_URI)
      await vi.waitFor(() => expect(flushes).toHaveLength(1))
    })

    expect(flushes[0].document.spaces[0].nodeIds).toHaveLength(1)
    expect(flushes[0].document.nodes[0].data.kind).toBe('document')
  })
})
