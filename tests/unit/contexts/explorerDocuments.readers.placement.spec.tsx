import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FILESYSTEM_ENTRY_MIME } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/filesystemDrag'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
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
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'

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
const documentCount = (workspaceId: string) =>
  documentOf(workspaceId).nodes.filter(node => node.data.kind === 'document').length

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
      replaceSpacesInStore(A, [spaceAt('space-a', ['terminal'])])
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
      replaceSpacesInStore(A, [spaceAt('space-now', ['folder'])])
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
