import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FILESYSTEM_ENTRY_MIME } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/filesystemDrag'
import {
  replaceWorkspaceNodes,
  replaceWorkspaceSpaces,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import {
  documentOf,
  stubOpencoveApi,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
} from '../../support/agentRuntimeHarness'
import {
  displayBWhileRenderingA,
  documentNodeAt,
  folderNodeAt,
  LOCAL,
  renderExplorer,
  renderFilesystemNodes,
  renderNavigation,
  renderOpening,
  spaceAt,
  terminalNodeAt,
} from '../../support/explorerDocumentsHarness'

// The document opening, the document navigation, the explorer and the filesystem nodes read the
// committed nodes and Spaces of the workspace whose render made them, from the store, when they
// run (#702, PR 12). Each case writes the store in the same `act` as the read, or shows another
// workspace: a read of a ref, a prop, React Flow or the canvas view gives another answer.
//
// The canvas store's own values keep the value of the first render, so only the document reader
// can make a callback follow the workspace shown. A reader that is missing from a dependency list,
// or frozen to the first render, then reads the first workspace after a switch.

const firstRender = vi.hoisted(() => ({ values: new Map<string, unknown>() }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext',
  async importOriginal => {
    const original = await importOriginal<Record<string, () => unknown>>()
    const stable = (name: string) => () => {
      const real = original[name]()
      if (!firstRender.values.has(name)) {
        firstRender.values.set(name, real)
      }
      return firstRender.values.get(name)
    }
    return {
      ...original,
      useCanvasUiCommands: stable('useCanvasUiCommands'),
      useCanvasSelectionCommands: stable('useCanvasSelectionCommands'),
      useCanvasDocumentCommands: stable('useCanvasDocumentCommands'),
      useReadCanvasUi: stable('useReadCanvasUi'),
      useReadCanvasSelection: stable('useReadCanvasSelection'),
    }
  },
)
vi.mock('@app/renderer/i18n', () => {
  const translation = { t: (key: string) => key }
  return { useTranslation: () => translation }
})

const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  filesystem: vi.fn(),
  preview: vi.fn(),
  // Replaces the preview placement for a case that needs `avoidRects`; the real one otherwise.
  placement: null as null | ((...args: unknown[]) => unknown),
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

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceExplorer.placement',
  async importOriginal => {
    const original = await importOriginal<Record<string, (...args: unknown[]) => unknown>>()
    return {
      ...original,
      resolveFlowRectPlacement: (...args: unknown[]) =>
        mocks.placement ? mocks.placement(...args) : original.resolveFlowRectPlacement(...args),
    }
  },
)

beforeEach(() => {
  mocks.placement = null
  firstRender.values.clear()
  mocks.binding.mockReset().mockResolvedValue(LOCAL)
  mocks.filesystem.mockReset().mockReturnValue({ stat: vi.fn(async () => ({ kind: 'file' })) })
  mocks.preview.mockReset().mockResolvedValue({
    kind: 'document',
    naturalWidth: undefined,
    naturalHeight: undefined,
    size: { width: 300, height: 200 },
  })
})

const URI = 'file:///repo/readme.md'
const request = (overrides: Record<string, unknown> = {}) => ({
  uri: URI,
  mountId: null,
  spaceId: null,
  anchor: { x: 100, y: 100 },
  ...overrides,
})
const documentCount = (workspaceId: string) =>
  documentOf(workspaceId).nodes.filter(node => node.data.kind === 'document').length

describe('the document opening', () => {
  it('reuses a document node that a store write added in the same act', async () => {
    const { view } = renderOpening({ a: { nodes: [] } })

    let opened: { id: string } | null = null
    await act(async () => {
      replaceWorkspaceNodes(A, [documentNodeAt('written-now', URI)])
      opened = await view.result.current(request())
    })

    expect(opened).toMatchObject({ id: 'written-now' })
    expect(documentCount(A)).toBe(1)
  })

  it('reuses a document that a write adds while the mount binding resolves', async () => {
    let finish!: (value: unknown) => void
    mocks.binding.mockReturnValue(new Promise(resolve => (finish = resolve)))
    const { view } = renderOpening({ a: { nodes: [] } })

    let opened: { id: string } | null = null
    await act(async () => {
      const pending = view.result.current(request())
      replaceWorkspaceNodes(A, [documentNodeAt('concurrent', URI)])
      finish(LOCAL)
      opened = await pending
    })

    expect(opened).toMatchObject({ id: 'concurrent' })
    expect(documentCount(A)).toBe(1)
  })

  it('finds a Space that a store write added in the same act and places the document in it', async () => {
    const { view } = renderOpening({ a: { nodes: [] } })

    let opened: { id: string } | null = null
    await act(async () => {
      replaceWorkspaceSpaces(A, [spaceAt('space-now')])
      opened = await view.result.current(request({ spaceId: 'space-now' }))
    })

    expect(opened).not.toBeNull()
    expect(documentOf(A).spaces[0].nodeIds).toEqual([opened!.id])
  })

  it('creates nothing when its Space is removed while the mount binding resolves', async () => {
    let finish!: (value: unknown) => void
    mocks.binding.mockReturnValue(new Promise(resolve => (finish = resolve)))
    const { view } = renderOpening({ a: { spaces: [spaceAt('space-a')] } })

    let opened: unknown = 'unset'
    await act(async () => {
      const pending = view.result.current(request({ spaceId: 'space-a' }))
      replaceWorkspaceSpaces(A, [])
      finish(LOCAL)
      opened = await pending
    })

    expect(opened).toBeNull()
    expect(documentCount(A)).toBe(0)
  })

  describe('a render of workspace A while workspace B is displayed', () => {
    it('reuses a document of A', async () => {
      const rendered = renderOpening({ a: { nodes: [documentNodeAt('doc-a', URI)] } })
      displayBWhileRenderingA(rendered)

      let opened: { id: string } | null = null
      await act(async () => {
        opened = await rendered.view.result.current(request())
      })

      expect(opened).toMatchObject({ id: 'doc-a' })
      expect(documentCount(A)).toBe(1)
      expect(documentCount(B)).toBe(0)
    })

    it('places a document in a Space of A', async () => {
      const rendered = renderOpening({ a: { spaces: [spaceAt('space-a')] } })
      displayBWhileRenderingA(rendered)

      let opened: { id: string } | null = null
      await act(async () => {
        opened = await rendered.view.result.current(request({ spaceId: 'space-a' }))
      })

      expect(documentOf(A).spaces[0].nodeIds).toEqual([opened!.id])
      expect(documentOf(B).nodes).toHaveLength(0)
    })
  })

  describe('the render that shows workspace B', () => {
    it('reads B, not the workspace the first render read', async () => {
      const rendered = renderOpening(
        {
          a: { nodes: [documentNodeAt('doc-a', URI)] },
          b: { nodes: [documentNodeAt('doc-b', URI)] },
        },
        { fixedWorkspaceId: true },
      )
      rendered.showB()

      let opened: { id: string } | null = null
      await act(async () => {
        opened = await rendered.view.result.current(request())
      })

      expect(opened).toMatchObject({ id: 'doc-b' })
    })

    it('keeps reading A through the callback of the render that showed A', async () => {
      const rendered = renderOpening(
        {
          a: { nodes: [documentNodeAt('doc-a', URI)] },
          b: { nodes: [documentNodeAt('doc-b', URI)] },
        },
        { fixedWorkspaceId: true },
      )
      const madeInA = rendered.view.result.current
      rendered.showB()

      let opened: { id: string } | null = null
      await act(async () => {
        opened = await madeInA(request())
      })

      expect(opened).toMatchObject({ id: 'doc-a' })
    })
  })
})

describe('the document navigation', () => {
  const source = () => terminalNodeAt('terminal', LOCAL, { x: 50, y: 50 })
  const link = { uri: URI, mountId: null, line: 3 }

  it('opens a document node that a store write added in the same act', async () => {
    const { view } = renderNavigation({
      a: { nodes: [source()], spaces: [spaceAt('space-a', ['terminal'])] },
    })

    let opened = false
    await act(async () => {
      replaceWorkspaceNodes(A, [source(), documentNodeAt('written-now', URI)])
      replaceWorkspaceSpaces(A, [spaceAt('space-a', ['terminal', 'written-now'])])
      opened = await view.result.current.openFileLink('terminal', link)
    })

    expect(opened).toBe(true)
    expect(documentCount(A)).toBe(1)
    expect(view.result.current.navigationByNode.get('written-now')).toMatchObject({ line: 3 })
  })

  it('finds a source node that a store write added in the same act', async () => {
    const { view } = renderNavigation({ a: { nodes: [] } })

    let opened = false
    await act(async () => {
      replaceWorkspaceNodes(A, [source()])
      opened = await view.result.current.openFileLink('terminal', link)
    })

    expect(opened).toBe(true)
  })

  it('refuses a link when a store write in the same act removed its source node', async () => {
    const { view } = renderNavigation({ a: { nodes: [source()] } })

    let opened = true
    await act(async () => {
      replaceWorkspaceNodes(A, [])
      opened = await view.result.current.openFileLink('terminal', link)
    })

    expect(opened).toBe(false)
  })

  it('drops the pending jump when a store write removes the document, at the next render', async () => {
    const { view } = renderNavigation({
      a: {
        nodes: [source(), documentNodeAt('doc', URI)],
        spaces: [spaceAt('space-a', ['terminal', 'doc'])],
      },
    })
    await act(async () => {
      await view.result.current.openFileLink('terminal', link)
    })
    expect(view.result.current.navigationByNode.size).toBe(1)

    act(() => {
      replaceWorkspaceNodes(A, [source()])
      view.rerender()
    })

    expect(view.result.current.navigationByNode.size).toBe(0)
  })

  describe('a render of workspace A while workspace B is displayed', () => {
    it('opens a link from a source node of A', async () => {
      const rendered = renderNavigation({
        a: {
          nodes: [source(), documentNodeAt('doc-a', URI)],
          spaces: [spaceAt('space-a', ['terminal', 'doc-a'])],
        },
      })
      displayBWhileRenderingA(rendered)

      let opened = false
      await act(async () => {
        opened = await rendered.view.result.current.openFileLink('terminal', link)
      })

      expect(opened).toBe(true)
      expect(documentCount(B)).toBe(0)
    })

    it('prunes the pending jump of A when A, not B, drops the document', async () => {
      const rendered = renderNavigation({
        a: {
          nodes: [source(), documentNodeAt('doc-a', URI)],
          spaces: [spaceAt('space-a', ['terminal', 'doc-a'])],
        },
        b: { nodes: [documentNodeAt('doc-a', URI)] },
      })
      await act(async () => {
        await rendered.view.result.current.openFileLink('terminal', link)
      })
      displayBWhileRenderingA(rendered)
      expect(rendered.view.result.current.navigationByNode.size).toBe(1)

      act(() => {
        replaceWorkspaceNodes(A, [source()])
        rendered.view.rerender()
      })

      expect(rendered.view.result.current.navigationByNode.size).toBe(0)
    })
  })

  describe('the render that shows workspace B', () => {
    it('reads B, not the workspace the first render read', async () => {
      const rendered = renderNavigation(
        { a: { nodes: [] }, b: { nodes: [source()] } },
        { fixedWorkspaceId: true },
      )
      rendered.showB()

      let opened = false
      await act(async () => {
        opened = await rendered.view.result.current.openFileLink('terminal', link)
      })

      expect(opened).toBe(true)
    })
  })
})

describe('the explorer', () => {
  it('finds a blocking open document that a store write added in the same act', () => {
    const { view } = renderExplorer({ a: { nodes: [] } })

    let block: unknown = null
    act(() => {
      replaceWorkspaceNodes(A, [documentNodeAt('open-doc', 'file:///repo/docs/a.md')])
      block = view.result.current.findBlockingOpenDocument('file:///repo/docs')
    })

    expect(block).toMatchObject({ uri: 'file:///repo/docs/a.md' })
  })

  const openExplorerOf = (
    view: ReturnType<typeof renderExplorer>['view'],
    spaceId = 'space-a',
  ): void => {
    act(() => {
      view.result.current.openSpaceExplorer(spaceId)
    })
  }

  it('reads the mount of a Space that a store write changed in the same act', async () => {
    const { view } = renderExplorer({ a: { spaces: [spaceAt('space-a')] } })
    openExplorerOf(view)

    await act(async () => {
      replaceWorkspaceSpaces(A, [spaceAt('space-a', [], { targetMountId: 'remote-mount' })])
      view.result.current.previewFileInSpace('space-a', URI)
    })

    await vi.waitFor(() =>
      expect(view.result.current.quickPreview).toMatchObject({
        spaceId: 'space-a',
        mountId: 'remote-mount',
      }),
    )
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ mountId: 'remote-mount' }))
  })

  it('places the preview away from a node that a store write added in the same act', async () => {
    const { view } = renderExplorer({ a: { spaces: [spaceAt('space-a')] } })
    openExplorerOf(view)
    await act(async () => {
      view.result.current.previewFileInSpace('space-a', URI)
    })
    await vi.waitFor(() => expect(view.result.current.quickPreview).not.toBeNull())
    const free = view.result.current.quickPreview!.rect

    await act(async () => {
      replaceWorkspaceNodes(A, [
        documentNodeAt('blocker', 'file:///repo/blocker.md', LOCAL, { x: free.x, y: free.y }),
      ])
      view.result.current.previewFileInSpace('space-a', URI)
    })

    await vi.waitFor(() => expect(view.result.current.quickPreview?.rect).not.toEqual(free))
  })

  // Drags the preview of `space-a` past the threshold, so that it is materialized, and returns the
  // nodes the drag session began with and the document the store then holds.
  async function dragPreview(rendered: ReturnType<typeof renderExplorer>, showB = false) {
    const { view, nodeDragSession } = rendered
    openExplorerOf(view)
    await act(async () => {
      view.result.current.previewFileInSpace('space-a', URI)
    })
    await vi.waitFor(() => expect(view.result.current.quickPreview).not.toBeNull())
    nodeDragSession.dragBaselinePositionByIdRef.current = new Map()
    nodeDragSession.dragBaselineSpaceRectByIdRef.current = new Map()
    if (showB) {
      displayBWhileRenderingA(rendered)
    }

    await act(async () => {
      view.result.current.beginQuickPreviewDrag({
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as never)
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 40 }))
      await vi.waitFor(() => expect(nodeDragSession.beginNodeDragSession).toHaveBeenCalled())
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 40, clientY: 40 }))
    })
    const created = documentOf(A).nodes.find(node => node.data.kind === 'document')!
    const sessionNodes = nodeDragSession.beginNodeDragSession.mock.calls[0][0] as Array<{
      id: string
    }>
    return { created, sessionNodeIds: sessionNodes.map(node => node.id) }
  }

  it('materializes a preview with the document the store holds, found through its own id', async () => {
    const { created, sessionNodeIds } = await dragPreview(
      renderExplorer({ a: { spaces: [spaceAt('space-a')] } }),
    )

    expect(sessionNodeIds).toContain(created.id)
  })

  describe('a render of workspace A while workspace B is displayed', () => {
    it('materializes a preview with the document of A', async () => {
      const { created, sessionNodeIds } = await dragPreview(
        renderExplorer({ a: { spaces: [spaceAt('space-a')] } }),
        true,
      )

      expect(sessionNodeIds).toContain(created.id)
    })

    it('previews against a Space of A', async () => {
      const rendered = renderExplorer({
        a: { spaces: [spaceAt('space-a', [], { targetMountId: 'remote-mount' })] },
      })
      openExplorerOf(rendered.view)
      displayBWhileRenderingA(rendered)

      await act(async () => {
        rendered.view.result.current.previewFileInSpace('space-a', URI)
      })

      await vi.waitFor(() =>
        expect(rendered.view.result.current.quickPreview).toMatchObject({
          spaceId: 'space-a',
          mountId: 'remote-mount',
        }),
      )
    })

    it('finds a blocking open document of A', () => {
      const rendered = renderExplorer({ a: { nodes: [documentNodeAt('doc-a', URI)] } })
      displayBWhileRenderingA(rendered)

      expect(rendered.view.result.current.findBlockingOpenDocument(URI)).toMatchObject({
        uri: URI,
      })
    })
  })

  describe('the render that shows workspace B', () => {
    it('previews against a Space that only B holds', async () => {
      const rendered = renderExplorer(
        { a: {}, b: { spaces: [spaceAt('space-b', [], { targetMountId: 'remote-mount' })] } },
        { fixedWorkspaceId: true },
      )
      rendered.showB()
      openExplorerOf(rendered.view, 'space-b')

      await act(async () => {
        rendered.view.result.current.previewFileInSpace('space-b', URI)
      })

      await vi.waitFor(() =>
        expect(rendered.view.result.current.quickPreview).toMatchObject({
          spaceId: 'space-b',
          mountId: 'remote-mount',
        }),
      )
    })

    it('reads B for the blocking open document', () => {
      const rendered = renderExplorer({
        a: { nodes: [documentNodeAt('doc-a', 'file:///a.md')] },
        b: { nodes: [documentNodeAt('doc-b', 'file:///b.md')] },
      })
      rendered.showB()

      expect(rendered.view.result.current.findBlockingOpenDocument('file:///a.md')).toBeNull()
      expect(rendered.view.result.current.findBlockingOpenDocument('file:///b.md')).not.toBeNull()
    })
  })
})

describe('the filesystem nodes', () => {
  const folderUri = 'file:///repo/docs'
  const folder = () => folderNodeAt('folder', folderUri, 'file:///repo', { x: 50, y: 50 })
  const folderData = () => ({ ...folder().data.folder!, viewMode: 'list' as const })

  it('updates a folder that a store write added in the same act', () => {
    const { view } = renderFilesystemNodes({ a: { nodes: [] } })

    act(() => {
      replaceWorkspaceNodes(A, [folder()])
      view.result.current.actions.updateFolder('folder', folderData())
    })

    expect(documentOf(A).nodes[0].data.folder?.viewMode).toBe('list')
  })

  it('opens a file from a folder that a store write added in the same act', async () => {
    const { view } = renderFilesystemNodes({ a: { nodes: [] } })

    await act(async () => {
      replaceWorkspaceNodes(A, [folder()])
      view.result.current.actions.openFile('folder', `${folderUri}/a.md`)
    })

    await vi.waitFor(() => expect(documentCount(A)).toBe(1))
  })

  it('does not open a file when the folder is gone by the time the file is stat-ed', async () => {
    let finish!: (value: unknown) => void
    const stat = vi.fn(() => new Promise(resolve => (finish = resolve)))
    mocks.filesystem.mockReturnValue({ stat })
    const { view } = renderFilesystemNodes({ a: { nodes: [folder()] } })

    await act(async () => {
      view.result.current.actions.openFile('folder', `${folderUri}/a.md`)
      await vi.waitFor(() => expect(stat).toHaveBeenCalled())
      replaceWorkspaceNodes(A, [])
      finish({ kind: 'file' })
    })

    expect(documentCount(A)).toBe(0)
  })

  it('finds the open document that blocks a mutation, among nodes a store write just added', () => {
    const { view } = renderFilesystemNodes({ a: { nodes: [] } })

    let block: unknown = null
    act(() => {
      replaceWorkspaceNodes(A, [folder(), documentNodeAt('doc', `${folderUri}/a.md`)])
      block = view.result.current.actions.findBlockingOpenDocument('folder', `${folderUri}/a.md`)
    })

    expect(block).toMatchObject({ uri: `${folderUri}/a.md` })
  })

  it('reads the path of a node that a store write added in the same act', () => {
    const { view } = renderFilesystemNodes({ a: { nodes: [] } })

    let uri: string | null = null
    act(() => {
      replaceWorkspaceNodes(A, [documentNodeAt('doc', `${folderUri}/a.md`)])
      uri = view.result.current.actions.getNodePathUri('doc')
    })

    expect(uri).toBe(`${folderUri}/a.md`)
  })

  it('places an opened file in a Space that a store write added in the same act', async () => {
    const { view } = renderFilesystemNodes({ a: { nodes: [folder()] } })

    await act(async () => {
      replaceWorkspaceSpaces(A, [spaceAt('space-now', ['folder'])])
      view.result.current.actions.openFile('folder', `${folderUri}/a.md`)
    })

    await vi.waitFor(() => expect(documentCount(A)).toBe(1))
    const created = documentOf(A).nodes.find(node => node.data.kind === 'document')!
    expect(documentOf(A).spaces[0].nodeIds).toContain(created.id)
  })

  describe('a render of workspace A while workspace B is displayed', () => {
    it('updates a folder of A', () => {
      const rendered = renderFilesystemNodes({ a: { nodes: [folder()] } })
      displayBWhileRenderingA(rendered)

      act(() => {
        rendered.view.result.current.actions.updateFolder('folder', folderData())
      })

      expect(documentOf(A).nodes[0].data.folder?.viewMode).toBe('list')
    })

    it('opens a file from a folder of A', async () => {
      const rendered = renderFilesystemNodes({ a: { nodes: [folder()] } })
      displayBWhileRenderingA(rendered)

      await act(async () => {
        rendered.view.result.current.actions.openFile('folder', `${folderUri}/a.md`)
      })

      await vi.waitFor(() => expect(documentCount(A)).toBe(1))
      expect(documentCount(B)).toBe(0)
    })

    it('reads the path of a node of A', () => {
      const rendered = renderFilesystemNodes({ a: { nodes: [documentNodeAt('doc', URI)] } })
      displayBWhileRenderingA(rendered)

      expect(rendered.view.result.current.actions.getNodePathUri('doc')).toBe(URI)
    })
  })

  describe('the render that shows workspace B', () => {
    it('updates a folder that only B holds', () => {
      const rendered = renderFilesystemNodes(
        { a: { nodes: [] }, b: { nodes: [folder()] } },
        { fixedWorkspaceId: true },
      )
      rendered.showB()

      act(() => {
        rendered.view.result.current.actions.updateFolder('folder', folderData())
      })

      expect(documentOf(B).nodes[0].data.folder?.viewMode).toBe('list')
    })

    it('finds the blocking open document that only B holds', () => {
      const rendered = renderFilesystemNodes(
        { a: { nodes: [] }, b: { nodes: [folder(), documentNodeAt('doc', `${folderUri}/a.md`)] } },
        { fixedWorkspaceId: true },
      )
      rendered.showB()

      expect(
        rendered.view.result.current.actions.findBlockingOpenDocument(
          'folder',
          `${folderUri}/a.md`,
        ),
      ).toMatchObject({ uri: `${folderUri}/a.md` })
    })

    it('reads the path of a node that only B holds', () => {
      const rendered = renderFilesystemNodes(
        { a: { nodes: [] }, b: { nodes: [documentNodeAt('doc', URI)] } },
        { fixedWorkspaceId: true },
      )
      rendered.showB()

      expect(rendered.view.result.current.actions.getNodePathUri('doc')).toBe(URI)
    })
  })
})

describe('reads that only the store can answer', () => {
  it('R1 the navigation opens a document node written in the same act without resolving a binding', async () => {
    const source = () => terminalNodeAt('terminal', LOCAL, { x: 50, y: 50 })
    const { view } = renderNavigation({
      a: { nodes: [source()], spaces: [spaceAt('space-a', ['terminal'])] },
    })
    // A binding that cannot be resolved: only the reuse of the node the store holds opens the link.
    mocks.binding.mockResolvedValue(null)

    let opened = false
    await act(async () => {
      replaceWorkspaceNodes(A, [source(), documentNodeAt('written-now', URI)])
      replaceWorkspaceSpaces(A, [spaceAt('space-a', ['terminal', 'written-now'])])
      opened = await view.result.current.openFileLink('terminal', {
        uri: URI,
        mountId: null,
        line: 3,
      })
    })

    expect(opened).toBe(true)
    expect(mocks.binding).not.toHaveBeenCalled()
    expect(view.result.current.navigationByNode.get('written-now')).toMatchObject({ line: 3 })
  })

  it('R2 the opening reuses a document node written in the same act without resolving a binding', async () => {
    const { view } = renderOpening({ a: { nodes: [] } })

    let opened: { id: string } | null = null
    await act(async () => {
      replaceWorkspaceNodes(A, [documentNodeAt('written-now', URI)])
      opened = await view.result.current({
        uri: URI,
        mountId: null,
        spaceId: null,
        anchor: { x: 100, y: 100 },
      })
    })

    expect(opened).toMatchObject({ id: 'written-now' })
    expect(mocks.binding).not.toHaveBeenCalled()
  })
})

describe('the materialization after a switch during its awaits', () => {
  it('R3 begins the drag session with the nodes of the workspace that started the drag', async () => {
    let finish!: (value: unknown) => void
    // The node store's creator of the workspace that started the drag: it writes A.
    const createDocumentNode = vi.fn(
      (anchor: { x: number; y: number }, document: { uri: string }) => {
        const node = documentNodeAt('materialized', document.uri, LOCAL, anchor)
        replaceWorkspaceNodes(A, [...documentOf(A).nodes, node])
        return node
      },
    )
    const rendered = renderExplorer(
      {
        a: { spaces: [spaceAt('space-a')] },
        // B holds a Space of the same id, so that the explorer stays open after the switch.
        b: { nodes: [terminalNodeAt('b-only')], spaces: [spaceAt('space-a')] },
      },
      { fixedWorkspaceId: true, createDocumentNode: createDocumentNode as never },
    )
    const { view, nodeDragSession } = rendered
    act(() => {
      view.result.current.openSpaceExplorer('space-a')
    })
    await act(async () => {
      view.result.current.previewFileInSpace('space-a', URI)
    })
    await vi.waitFor(() => expect(view.result.current.quickPreview).not.toBeNull())
    mocks.binding.mockReturnValue(new Promise(resolve => (finish = resolve)))

    await act(async () => {
      view.result.current.beginQuickPreviewDrag({
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as never)
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 40 }))
      await vi.waitFor(() => expect(mocks.binding).toHaveBeenCalled())
    })
    rendered.showB()
    await act(async () => {
      finish(LOCAL)
      await vi.waitFor(() => expect(nodeDragSession.beginNodeDragSession).toHaveBeenCalled())
    })

    expect(createDocumentNode).toHaveBeenCalledOnce()
    const sessionNodeIds = (
      nodeDragSession.beginNodeDragSession.mock.calls[0][0] as Array<{ id: string }>
    ).map(node => node.id)
    expect(sessionNodeIds).toContain('materialized')
    expect(sessionNodeIds).not.toContain('b-only')
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 40, clientY: 40 }))
    })
  })
})

// Drags the open preview of `space-a` past the threshold and releases it; returns the drag session's
// first nodes and the finalize call.
async function dragOpenPreview(
  rendered: ReturnType<typeof renderExplorer>,
  beforeDrag?: () => void,
) {
  const { view, nodeDragSession, finalizeDraggedNodeDrop } = rendered
  act(() => {
    view.result.current.openSpaceExplorer('space-a')
  })
  await act(async () => {
    view.result.current.previewFileInSpace('space-a', URI)
  })
  await vi.waitFor(() => expect(view.result.current.quickPreview).not.toBeNull())
  nodeDragSession.dragBaselinePositionByIdRef.current = new Map()
  nodeDragSession.dragBaselineSpaceRectByIdRef.current = new Map()
  beforeDrag?.()
  await act(async () => {
    view.result.current.beginQuickPreviewDrag({
      clientX: 0,
      clientY: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as never)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 40 }))
    await vi.waitFor(() => expect(nodeDragSession.beginNodeDragSession).toHaveBeenCalled())
  })
  act(() => {
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 40, clientY: 40 }))
  })
  return {
    sessionNodeIds: (
      nodeDragSession.beginNodeDragSession.mock.calls[0][0] as Array<{ id: string }>
    ).map(n => n.id),
    finalize: finalizeDraggedNodeDrop.mock.calls[0]?.[0] as
      | { fallbackNodes: Array<{ id: string }> }
      | undefined,
  }
}

describe('the quick-preview drag after the render that shows B', () => {
  it('R4 begins the drag session with the nodes of B', async () => {
    const rendered = renderExplorer(
      {
        a: { nodes: [terminalNodeAt('a-only')], spaces: [spaceAt('space-a')] },
        b: { spaces: [spaceAt('space-a')] },
      },
      { fixedWorkspaceId: true },
    )
    rendered.showB()
    const { sessionNodeIds } = await dragOpenPreview(rendered)
    const created = documentOf(B).nodes.find(node => node.data.kind === 'document')
    expect(created).toBeDefined()
    expect(sessionNodeIds).toContain(created!.id)
    expect(sessionNodeIds).not.toContain('a-only')
  })
})

describe('the finalize of the quick-preview drag', () => {
  it('R7 hands the store node of the materialized preview to the drop as its fallback', async () => {
    const rendered = renderExplorer({ a: { spaces: [spaceAt('space-a')] } })
    const { finalize } = await dragOpenPreview(rendered)
    const created = documentOf(A).nodes.find(node => node.data.kind === 'document')!
    expect(finalize?.fallbackNodes.map(node => node.id)).toEqual([created.id])
  })

  it('R7b does the same in a render of A while B is displayed', async () => {
    const rendered = renderExplorer({ a: { spaces: [spaceAt('space-a')] } })
    const { finalize } = await dragOpenPreview(rendered, () => displayBWhileRenderingA(rendered))
    const created = documentOf(A).nodes.find(node => node.data.kind === 'document')!
    expect(finalize?.fallbackNodes.map(node => node.id)).toEqual([created.id])
  })
})

describe('more reads in a render of workspace A while workspace B is displayed', () => {
  const folderUri = 'file:///repo/docs'
  it('R5 the filesystem nodes find the open document of A that blocks a mutation', () => {
    const rendered = renderFilesystemNodes({
      a: {
        nodes: [
          folderNodeAt('folder', folderUri, 'file:///repo'),
          documentNodeAt('doc', `${folderUri}/a.md`),
        ],
      },
    })
    displayBWhileRenderingA(rendered)
    expect(
      rendered.view.result.current.actions.findBlockingOpenDocument('folder', `${folderUri}/a.md`),
    ).toMatchObject({ uri: `${folderUri}/a.md` })
  })

  it('R6 the filesystem nodes copy the path of a node of A', async () => {
    const writeText = vi.fn(async () => undefined)
    stubOpencoveApi({ clipboard: { writeText } })
    const rendered = renderFilesystemNodes({ a: { nodes: [documentNodeAt('doc', URI)] } })
    displayBWhileRenderingA(rendered)
    await act(async () => {
      await rendered.view.result.current.actions.copyNodePath('doc', false)
    })
    expect(writeText).toHaveBeenCalledWith('/repo/readme.md')
    vi.unstubAllGlobals()
  })

  it('R8 the explorer places a preview away from a node of A', async () => {
    const rendered = renderExplorer({ a: { spaces: [spaceAt('space-a')] } })
    const { view } = rendered
    act(() => {
      view.result.current.openSpaceExplorer('space-a')
    })
    await act(async () => {
      view.result.current.previewFileInSpace('space-a', URI)
    })
    await vi.waitFor(() => expect(view.result.current.quickPreview).not.toBeNull())
    const free = view.result.current.quickPreview!.rect
    act(() => {
      replaceWorkspaceNodes(A, [
        documentNodeAt('blocker', 'file:///repo/blocker.md', LOCAL, { x: free.x, y: free.y }),
      ])
    })
    displayBWhileRenderingA(rendered)
    await act(async () => {
      view.result.current.previewFileInSpace('space-a', URI)
    })
    await vi.waitFor(() => expect(view.result.current.quickPreview?.rect).not.toEqual(free))
  })
})

// The reads that the first pins left open: the reposition after a creation, the placement's Space
// obstacles, the navigation's anchor Space and destination, the materialization's Space after its
// awaits, and the readers of two callbacks that only a switch can rebuild.
describe('the reposition after a creation', () => {
  const blocker = () =>
    documentNodeAt('blocker', 'file:///repo/blocker.md', LOCAL, { x: 100, y: 100 })
  const AVOID = [{ x: -5000, y: -5000, width: 1, height: 1 }]
  // A creator that writes the node at the anchor of workspace A, as the node store does for a
  // free anchor; the reposition then moves it only if the nodes it reads hold something there.
  const creatorInA = () =>
    vi.fn((anchor: { x: number; y: number }, document: { uri: string }) => {
      const node = documentNodeAt('created', document.uri, LOCAL, anchor)
      replaceWorkspaceNodes(A, [...documentOf(A).nodes, node])
      return node
    })
  const openAt = (view: ReturnType<typeof renderOpening>['view']) =>
    view.result.current({
      uri: URI,
      mountId: null,
      spaceId: null,
      anchor: { x: 100, y: 100 },
      placement: { preferredDirection: 'right', avoidRects: AVOID },
    })
  const positionOfCreated = () => documentOf(A).nodes.find(node => node.id === 'created')!.position

  it('keeps the node where it was created when nothing blocks it', async () => {
    const { view } = renderOpening({ a: {} }, { createDocumentNode: creatorInA() as never })

    await act(async () => {
      await openAt(view)
    })

    expect(positionOfCreated()).toEqual({ x: 100, y: 100 })
  })

  it('moves the node away from a node that a store write added in the same act', async () => {
    const { view } = renderOpening({ a: {} }, { createDocumentNode: creatorInA() as never })

    await act(async () => {
      replaceWorkspaceNodes(A, [blocker()])
      await openAt(view)
    })

    expect(positionOfCreated()).not.toEqual({ x: 100, y: 100 })
  })

  it('moves the node away from a node of A in a render of A while B is displayed', async () => {
    const rendered = renderOpening(
      { a: { nodes: [blocker()] } },
      { createDocumentNode: creatorInA() as never },
    )
    displayBWhileRenderingA(rendered)

    await act(async () => {
      await openAt(rendered.view)
    })

    expect(positionOfCreated()).not.toEqual({ x: 100, y: 100 })
  })

  it('moves an image the explorer creates away from a node of A in a render of A while B is displayed', async () => {
    const IMAGE = 'file:///repo/picture.png'
    mocks.placement = () => ({
      rect: { x: 100, y: 100, width: 200, height: 150 },
      anchor: { x: 100, y: 100 },
      preferredDirection: 'right',
      avoidRects: AVOID,
    })
    mocks.preview.mockResolvedValue({
      kind: 'image',
      naturalWidth: 40,
      naturalHeight: 30,
      size: { width: 200, height: 150 },
    })
    mocks.filesystem.mockReturnValue({
      readFileBytes: vi.fn(async () => ({ bytes: new Uint8Array(3) })),
    })
    stubOpencoveApi({ workspace: { writeCanvasImage: vi.fn(async () => undefined) } })
    const createImageNode = vi.fn(() => {
      const node = { ...documentNodeAt('created', IMAGE, LOCAL, { x: 100, y: 100 }) }
      replaceWorkspaceNodes(A, [...documentOf(A).nodes, node])
      return node
    })
    const rendered = renderExplorer(
      { a: { nodes: [blocker()], spaces: [spaceAt('space-a')] } },
      { createImageNode },
    )
    displayBWhileRenderingA(rendered)

    await act(async () => {
      rendered.view.result.current.openFileInSpace('space-a', IMAGE)
      await vi.waitFor(() => expect(createImageNode).toHaveBeenCalled())
    })

    await vi.waitFor(() => expect(positionOfCreated()).not.toEqual({ x: 100, y: 100 }))
  })
})

describe('the preview placement', () => {
  it('avoids a Space of A in a render of A while B is displayed', async () => {
    const target = spaceAt('space-a', [], { rect: { x: 0, y: 0, width: 1200, height: 900 } })
    const other = spaceAt('space-x', [], { rect: { x: 0, y: 0, width: 700, height: 900 } })
    const place = async (spaces: ReturnType<typeof spaceAt>[], showB: boolean) => {
      const rendered = renderExplorer({ a: { spaces } })
      act(() => {
        rendered.view.result.current.openSpaceExplorer('space-a')
      })
      if (showB) {
        displayBWhileRenderingA(rendered)
      }
      await act(async () => {
        rendered.view.result.current.previewFileInSpace('space-a', URI)
      })
      await vi.waitFor(() => expect(rendered.view.result.current.quickPreview).not.toBeNull())
      return rendered.view.result.current.quickPreview!.rect
    }

    const alone = await place([target], false)
    const withOther = await place([target, other], true)

    expect(withOther).not.toEqual(alone)
  })
})

describe('the navigation of a document link', () => {
  const source = () => terminalNodeAt('terminal', LOCAL, { x: 50, y: 50 })
  const link = { uri: URI, mountId: null, line: 3 }

  it('anchors a new document in the Space of A in a render of A while B is displayed', async () => {
    const createDocumentNode = vi.fn(() => null)
    const rendered = renderNavigation(
      { a: { nodes: [source()], spaces: [spaceAt('space-a', ['terminal'])] } },
      { createDocumentNode: createDocumentNode as never },
    )
    displayBWhileRenderingA(rendered)

    await act(async () => {
      await rendered.view.result.current.openFileLink('terminal', link)
    })

    expect(createDocumentNode).toHaveBeenCalledOnce()
    expect((createDocumentNode.mock.calls[0] as unknown[])[0]).toEqual({ x: 24, y: 46 })
  })

  it('places a new document in a Space that a store write gave the source in the same act', async () => {
    const createDocumentNode = vi.fn(() => null)
    const { view } = renderNavigation(
      { a: { nodes: [source()] } },
      { createDocumentNode: createDocumentNode as never },
    )

    await act(async () => {
      replaceWorkspaceSpaces(A, [spaceAt('space-a', ['terminal'])])
      await view.result.current.openFileLink('terminal', link)
    })

    expect(createDocumentNode).toHaveBeenCalledOnce()
    const placement = (createDocumentNode.mock.calls[0] as unknown[])[2] as {
      targetSpaceRect: unknown
    }
    expect(placement.targetSpaceRect).toEqual({ x: 0, y: 0, width: 1200, height: 900 })
  })
})

describe('the file opened from a folder node, after its awaits', () => {
  const folderUri = 'file:///repo/docs'
  const folder = () => folderNodeAt('folder', folderUri, 'file:///repo', { x: 50, y: 50 })

  it('places the document in a Space that a store write added while the file was stat-ed', async () => {
    let finish!: (value: unknown) => void
    const stat = vi.fn(() => new Promise(resolve => (finish = resolve)))
    mocks.filesystem.mockReturnValue({ stat })
    const { view } = renderFilesystemNodes({ a: { nodes: [folder()] } })

    await act(async () => {
      view.result.current.actions.openFile('folder', `${folderUri}/a.md`)
      await vi.waitFor(() => expect(stat).toHaveBeenCalled())
      replaceWorkspaceSpaces(A, [spaceAt('space-now', ['folder'])])
      finish({ kind: 'file' })
    })

    await vi.waitFor(() => expect(documentCount(A)).toBe(1))
    const created = documentOf(A).nodes.find(node => node.data.kind === 'document')!
    expect(documentOf(A).spaces[0].nodeIds).toContain(created.id)
  })

  describe('the render that shows workspace B', () => {
    it('materializes a drop into a Space that only B holds', async () => {
      const rendered = renderFilesystemNodes(
        { a: {}, b: { spaces: [spaceAt('space-b')] } },
        { fixedWorkspaceId: true },
      )
      rendered.showB()
      const entry = {
        version: 1,
        kind: 'file',
        uri: `${folderUri}/a.md`,
        rootUri: 'file:///repo',
        mountId: null,
      }

      await act(async () => {
        rendered.view.result.current.handleDrop({
          target: document.createElement('div'),
          clientX: 100,
          clientY: 100,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          dataTransfer: {
            types: [FILESYSTEM_ENTRY_MIME],
            getData: (type: string) =>
              type === FILESYSTEM_ENTRY_MIME ? JSON.stringify(entry) : '',
          },
        } as never)
        await vi.waitFor(() => expect(documentCount(B)).toBe(1))
      })

      const created = documentOf(B).nodes.find(node => node.data.kind === 'document')!
      expect(documentOf(B).spaces[0].nodeIds).toContain(created.id)
    })

    it('copies the path of a node that only B holds', async () => {
      const writeText = vi.fn(async () => undefined)
      stubOpencoveApi({ clipboard: { writeText } })
      const rendered = renderFilesystemNodes(
        { a: {}, b: { nodes: [documentNodeAt('doc', URI)] } },
        { fixedWorkspaceId: true },
      )
      rendered.showB()

      await act(async () => {
        await rendered.view.result.current.actions.copyNodePath('doc', false)
      })

      expect(writeText).toHaveBeenCalledWith('/repo/readme.md')
      vi.unstubAllGlobals()
    })
  })
})
