import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragEvent } from 'react'
import {
  useFilesystemNodes,
  type FilesystemNodesParams,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useFilesystemNodes'
import { readNativeDroppedFiles } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nativeFilesystemDrop'
import { useWorkspaceCanvasFilesystemNodeCreation } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.createFilesystemNodes'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useCanvasCollapseStore } from '@contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { storeBackedChannelsOf } from '../../support/workspaceCanvasStoreHarness'

vi.mock('@xyflow/react', async importOriginal => ({
  ...(await importOriginal<object>()),
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x / 2, y: y / 2 }),
  }),
}))

function nativeDrop(files: File[]): DragEvent<HTMLDivElement> {
  return {
    target: document.createElement('div'),
    clientX: 800,
    clientY: 600,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { types: ['Files'], files, getData: () => '' },
  } as unknown as DragEvent<HTMLDivElement>
}

// The drop lands inside a remote Space, but an OS file belongs to the desktop host.
const remoteSpace = (): WorkspaceSpaceState =>
  ({
    id: 'remote-space',
    name: 'Remote',
    directoryPath: '/remote',
    labelColor: null,
    nodeIds: [],
    rect: { x: 0, y: 0, width: 900, height: 900 },
    targetMountId: 'ssh-mount',
  }) as WorkspaceSpaceState

/**
 * Renders the filesystem nodes of workspace `one` under its canvas store provider. The app store
 * holds `one` with the remote Space and `two` with the Spaces of `twoSpaces`. `show('two')` moves
 * the provider, the hook's workspace and the app store's active workspace together; the other
 * moves only the app store's active workspace, so the render stays on `one` while `two` is shown.
 */
function setup({ twoSpaces = [] as WorkspaceSpaceState[] } = {}) {
  const createDocumentNode = vi.fn<FilesystemNodesParams['nodeStore']['createDocumentNode']>(
    () => null,
  )
  const createFolderNode = vi.fn<FilesystemNodesParams['nodeStore']['createFolderNode']>(() => null)
  const onShowMessage = vi.fn()
  const harness = createCanvasDocumentHarness({ workspaceId: 'one', spaces: [remoteSpace()] })
  useAppStore.setState(state => ({
    workspaces: [
      ...state.workspaces,
      { ...state.workspaces[0], id: 'two', nodes: [], spaces: twoSpaces },
    ],
  }))
  const params: Omit<FilesystemNodesParams, 'workspaceId'> = {
    nodeStore: {
      setNodes: vi.fn(),
      updateCanvasDocument: vi.fn(),
      createDocumentNode,
      createFolderNode,
    },
    onShowMessage,
  }
  let shown = 'one'
  let hookWorkspace = 'one'
  const hook = renderInCanvasDocument(
    () => useFilesystemNodes({ ...params, workspaceId: hookWorkspace }),
    {
      workspaceId: () => shown,
    },
  )
  return {
    ...hook,
    harness,
    createDocumentNode,
    createFolderNode,
    onShowMessage,
    spacesRef: storeBackedChannelsOf('one').spacesRef,
    show: (workspaceId: string) =>
      act(() => {
        shown = workspaceId
        hookWorkspace = workspaceId
        useAppStore.setState({ activeWorkspaceId: workspaceId })
        hook.rerender()
      }),
    /** Moves the provider and the active workspace but keeps the hook's own workspace id. */
    showKeepingHookWorkspace: (workspaceId: string) =>
      act(() => {
        shown = workspaceId
        useAppStore.setState({ activeWorkspaceId: workspaceId })
        hook.rerender()
      }),
    displayTwoWhileRenderingOne: () =>
      act(() => {
        useAppStore.setState({ activeWorkspaceId: 'two' })
        hook.rerender()
      }),
  }
}

describe('native filesystem drops', () => {
  const nativePaths = new Map<File, string>()
  const getPathForFile = vi.fn((file: File) => nativePaths.get(file) ?? '')
  const stat = vi.fn()
  const resolveDroppedFile = vi.fn()
  beforeEach(() => {
    nativePaths.clear()
    getPathForFile.mockClear()
    stat.mockReset().mockImplementation(({ uri }) => ({
      uri,
      kind: uri.endsWith('/docs') ? 'directory' : 'file',
    }))
    resolveDroppedFile
      .mockReset()
      .mockImplementation((file: File) => stat({ uri: `file://${nativePaths.get(file)}` }))
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { filesystem: { getPathForFile, resolveDroppedFile, stat } },
    })
    useCanvasCollapseStore.setState({ workspaces: {} })
  })
  afterEach(cleanup)

  it('materializes files and folders as centered local icons in a remote Space at the original flow point', async () => {
    const file = new File(['hello'], 'same-name.md')
    const directory = new File([], 'docs')
    nativePaths.set(file, '/external/actual-name.md')
    nativePaths.set(directory, '/external/docs')
    const view = setup()
    const event = nativeDrop([file, directory])
    await act(async () => {
      view.result.current.handleNativeDrop(event)
    })
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(view.createDocumentNode).toHaveBeenCalledWith(
      { x: 344, y: 252 },
      { uri: 'file:///external/actual-name.md' },
      expect.objectContaining({ focusViewportOnCreate: false }),
      { endpointId: 'local', mountId: null },
      { workspaceId: 'one', collapsed: true },
    )
    expect(view.createFolderNode).toHaveBeenCalledWith(
      { x: 476, y: 252 },
      expect.objectContaining({ uri: 'file:///external/docs', rootUri: 'file:///external/docs' }),
      { endpointId: 'local', mountId: null },
      'one',
      expect.any(Object),
    )
    expect(resolveDroppedFile).toHaveBeenNthCalledWith(1, file)
    expect(resolveDroppedFile).toHaveBeenNthCalledWith(2, directory)
  })

  it('keeps a whole batch in the initially targeted Space when later icons cross its original edge', async () => {
    const file = new File([], 'note.md')
    const folder = new File([], 'docs')
    nativePaths.set(file, '/external/note.md')
    nativePaths.set(folder, '/external/docs')
    const view = setup()
    const rect = { x: 350, y: 250, width: 100, height: 100 }
    view.spacesRef.current[0].rect = rect
    await act(async () => {
      view.result.current.handleNativeDrop(nativeDrop([file, folder]))
    })
    expect(view.createDocumentNode.mock.calls[0][2]).toMatchObject({ targetSpaceRect: rect })
    expect(view.createFolderNode.mock.calls[0][4]).toMatchObject({ targetSpaceRect: rect })
    // The second anchor lies outside the initial bounds, but the batch keeps its owner.
    expect(view.createFolderNode.mock.calls[0][0].x).toBeGreaterThan(rect.x + rect.width)
  })

  it('keeps a root-canvas batch outside a neighboring Space even when an offset anchor reaches it', async () => {
    const file = new File([], 'note.md')
    const folder = new File([], 'docs')
    nativePaths.set(file, '/external/note.md')
    nativePaths.set(folder, '/external/docs')
    const view = setup()
    view.spacesRef.current[0].rect = { x: 500, y: 250, width: 100, height: 100 }
    await act(async () => {
      view.result.current.handleNativeDrop(nativeDrop([file, folder]))
    })
    expect(view.createDocumentNode.mock.calls[0][2]).toMatchObject({ targetSpaceRect: null })
    expect(view.createFolderNode.mock.calls[0][4]).toMatchObject({ targetSpaceRect: null })
  })

  it.each(['switch', 'unmount', 'remove-space'])(
    'does not publish or approve remaining files after %s during a native approval',
    async transition => {
      const files = [new File([], 'first'), new File([], 'second')]
      files.forEach((file, index) => nativePaths.set(file, `/external/${index}.md`))
      let finish!: (value: unknown) => void
      resolveDroppedFile.mockReturnValue(
        new Promise(resolve => {
          finish = resolve
        }),
      )
      const view = setup()
      await act(async () => {
        view.result.current.handleNativeDrop(nativeDrop(files))
      })
      if (transition === 'switch') {
        view.show('two')
      } else if (transition === 'remove-space') {
        view.spacesRef.current = []
      } else {
        view.unmount()
      }
      await act(async () => {
        finish({ uri: 'file:///external/0.md', kind: 'file' })
      })
      expect(resolveDroppedFile).toHaveBeenCalledOnce()
      expect(stat).not.toHaveBeenCalled()
      expect(view.createDocumentNode).not.toHaveBeenCalled()
      expect(view.createFolderNode).not.toHaveBeenCalled()
    },
  )

  describe('a render of workspace one while workspace two is displayed', () => {
    const dropTwo = () => {
      const files = [new File([], 'first'), new File([], 'second')]
      files.forEach((file, index) => nativePaths.set(file, `/external/${index}.md`))
      return files
    }

    it('finds the Space under the drop in the Spaces of its own workspace', async () => {
      const file = new File([], 'note.md')
      nativePaths.set(file, '/external/note.md')
      const view = setup()
      view.displayTwoWhileRenderingOne()
      await act(async () => {
        view.result.current.handleNativeDrop(nativeDrop([file]))
      })
      expect(view.createDocumentNode.mock.calls[0][2]).toMatchObject({
        targetSpaceRect: { x: 0, y: 0, width: 900, height: 900 },
      })
    })

    it('ends the batch when its Space is removed, though the displayed workspace holds one of that id', async () => {
      const files = dropTwo()
      let finish!: (value: unknown) => void
      resolveDroppedFile.mockReturnValue(
        new Promise(resolve => {
          finish = resolve
        }),
      )
      const view = setup({ twoSpaces: [remoteSpace()] })
      view.displayTwoWhileRenderingOne()
      await act(async () => {
        view.result.current.handleNativeDrop(nativeDrop(files))
      })
      view.spacesRef.current = []
      await act(async () => {
        finish({ uri: 'file:///external/0.md', kind: 'file' })
      })
      expect(stat).not.toHaveBeenCalled()
      expect(view.createDocumentNode).not.toHaveBeenCalled()
    })

    it('keeps going while its Space is there, though the displayed workspace holds none', async () => {
      const files = dropTwo()
      const view = setup()
      view.displayTwoWhileRenderingOne()
      await act(async () => {
        view.result.current.handleNativeDrop(nativeDrop(files))
      })
      expect(view.createDocumentNode).toHaveBeenCalledTimes(2)
    })
  })

  it('drops onto the Spaces of the workspace the render shows, not of the first one', async () => {
    const file = new File([], 'note.md')
    nativePaths.set(file, '/external/note.md')
    const view = setup()
    view.showKeepingHookWorkspace('two')
    await act(async () => {
      view.result.current.handleNativeDrop(nativeDrop([file]))
    })
    expect(view.createDocumentNode.mock.calls[0][2]).toMatchObject({ targetSpaceRect: null })
  })

  it('ends the batch when a store write in the same act removes its Space after the first approval', async () => {
    const files = [new File([], 'first'), new File([], 'second')]
    files.forEach((file, index) => nativePaths.set(file, `/external/${index}.md`))
    const view = setup()
    resolveDroppedFile.mockImplementationOnce(async (file: File) => {
      view.spacesRef.current = []
      return stat({ uri: `file://${nativePaths.get(file)}` })
    })
    await act(async () => {
      view.result.current.handleNativeDrop(nativeDrop(files))
    })
    expect(resolveDroppedFile).toHaveBeenCalledOnce()
    expect(view.createDocumentNode).not.toHaveBeenCalled()
  })

  it('does not fabricate native paths from browser File names and preserves image fallback', async () => {
    delete window.opencoveApi.filesystem.resolveDroppedFile
    const file = new File(['text'], '/remote/readme.md')
    const view = setup()
    const unsupported = nativeDrop([file])
    const image = nativeDrop([new File([], 'image.png', { type: 'image/png' })])
    await act(async () => {
      view.result.current.handleNativeDrop(unsupported)
      view.result.current.handleNativeDrop(image)
    })
    expect(unsupported.preventDefault).toHaveBeenCalledOnce()
    expect(view.onShowMessage).toHaveBeenCalledOnce()
    expect(image.stopPropagation).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
    expect(view.createDocumentNode).not.toHaveBeenCalled()
  })

  it('deduplicates true native paths without conflating files with matching names', () => {
    const first = new File([], 'readme.md')
    const second = new File([], 'readme.md')
    const duplicate = new File([], 'readme.md')
    nativePaths.set(first, '/one/readme.md')
    nativePaths.set(second, '/two/readme.md')
    nativePaths.set(duplicate, '/one/readme.md')
    expect(readNativeDroppedFiles(nativeDrop([first, second, duplicate]).dataTransfer)).toEqual([
      first,
      second,
    ])
  })

  it.each([false, true])(
    'publishes document collapsed=%s while preserving durable expanded size',
    collapsed => {
      const nodesRef = { current: [] as Node<TerminalNodeData>[] }
      let collapsedAtPublish = false
      createCanvasDocumentHarness({ workspaceId: 'one' })
      const hook = renderInCanvasDocument(
        () =>
          useWorkspaceCanvasFilesystemNodeCreation({
            standardWindowSizeBucket: 'regular',
            setNodes: update => {
              nodesRef.current = update(nodesRef.current)
              collapsedAtPublish =
                useCanvasCollapseStore.getState().workspaces.one?.collapsedNodeIds[
                  nodesRef.current[0].id
                ] === true
            },
          }),
        { workspaceId: 'one' },
      )
      act(() => {
        hook.result.current.createDocumentNode(
          { x: 100, y: 100 },
          { uri: 'file:///docs/readme.md' },
          undefined,
          { endpointId: 'local', mountId: null },
          collapsed ? { workspaceId: 'one', collapsed: true } : undefined,
        )
      })
      expect(collapsedAtPublish).toBe(collapsed)
      expect(nodesRef.current[0].position).toEqual({ x: 100, y: 100 })
      expect(nodesRef.current[0].data.width).toBeGreaterThan(128)
      expect(nodesRef.current[0].data.height).toBeGreaterThan(112)
    },
  )
})
