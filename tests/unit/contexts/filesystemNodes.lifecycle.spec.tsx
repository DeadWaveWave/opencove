import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { toShellWorkspaceStateForSync } from '@app/renderer/shell/hooks/workerSync/mergeWorkspaceStateForSync'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragEvent } from 'react'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import {
  useFilesystemNodes,
  type FilesystemNodesParams,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useFilesystemNodes'
import { useWorkspaceCanvasFilesystemNodeCreation } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.createFilesystemNodes'
import { FILESYSTEM_ENTRY_MIME } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/filesystemDrag'
import { useCanvasCollapseStore } from '@contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ screenToFlowPosition: (point: unknown) => point }),
}))

const uri = 'file:///repo/docs'
function folder(): Node<TerminalNodeData> {
  return {
    id: 'folder',
    type: 'folderNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'folder',
      title: 'docs',
      sessionId: '',
      width: 480,
      height: 400,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
      workerBinding: { endpointId: 'local', mountId: null },
      folder: { uri, rootUri: 'file:///repo', viewMode: 'icons', expandedDirectoryUris: [] },
    },
  }
}

function setup() {
  const nodesRef = { current: [folder()] }
  const createDocumentNode = vi.fn(() => null)
  const createFolderNode = vi.fn(() => null)
  const onShowMessage = vi.fn()
  const params: Omit<FilesystemNodesParams, 'workspaceId'> = {
    nodeStore: {
      nodesRef,
      createDocumentNode,
      createFolderNode,
      setNodes: update => {
        nodesRef.current = update(nodesRef.current)
      },
    },
    spacesRef: { current: [] },
    onSpacesChange: vi.fn(),
    onShowMessage,
  }
  const view = renderHook(({ workspaceId }) => useFilesystemNodes({ ...params, workspaceId }), {
    initialProps: { workspaceId: 'one' },
  })
  return { ...view, nodesRef, createDocumentNode, createFolderNode, onShowMessage }
}

function drop(kind: 'file' | 'directory' = 'file'): DragEvent<HTMLDivElement> {
  return {
    target: document.createElement('div'),
    clientX: 600,
    clientY: 50,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      getData: (type: string) =>
        type === FILESYSTEM_ENTRY_MIME
          ? JSON.stringify({
              version: 1,
              kind,
              uri: kind === 'file' ? `${uri}/readme.md` : uri,
              rootUri: 'file:///repo',
              mountId: null,
            })
          : '',
    },
  } as unknown as DragEvent<HTMLDivElement>
}

describe('filesystem node ownership across async work', () => {
  const stat = vi.fn()
  beforeEach(() => {
    stat.mockReset().mockResolvedValue({ kind: 'file' })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { filesystem: { stat } },
    })
    useCanvasCollapseStore.setState({ workspaces: {} })
  })
  afterEach(cleanup)

  it('drops a file as a reference with explicit source binding', async () => {
    const view = setup()
    await act(async () => {
      view.result.current.handleDrop(drop())
    })
    expect(view.createDocumentNode).toHaveBeenCalledWith(
      { x: 600, y: 50 },
      { uri: `${uri}/readme.md` },
      expect.any(Object),
      { endpointId: 'local', mountId: null },
    )
    expect(view.createFolderNode).not.toHaveBeenCalled()
  })

  it('centers a dropped folder icon at the pointer without changing its source binding', async () => {
    stat.mockResolvedValue({ kind: 'directory' })
    const view = setup()
    await act(async () => {
      view.result.current.handleDrop(drop('directory'))
    })
    expect(view.createFolderNode).toHaveBeenCalledWith(
      { x: 544, y: 2 },
      expect.objectContaining({ uri, rootUri: 'file:///repo' }),
      { endpointId: 'local', mountId: null },
      'one',
      expect.objectContaining({ focusViewportOnCreate: false }),
    )
  })

  it('does not publish a drop after switching workspaces', async () => {
    let finish!: (value: { kind: string }) => void
    stat.mockReturnValue(
      new Promise(resolve => {
        finish = resolve
      }),
    )
    const view = setup()
    await act(async () => {
      view.result.current.handleDrop(drop())
    })
    view.rerender({ workspaceId: 'two' })
    await act(async () => {
      finish({ kind: 'file' })
    })
    expect(view.createDocumentNode).not.toHaveBeenCalled()
  })

  it.each(['close', 'navigate', 'unmount'])(
    'cancels pending folder opens after %s',
    async transition => {
      let finish!: (value: { kind: string }) => void
      stat.mockReturnValue(
        new Promise(resolve => {
          finish = resolve
        }),
      )
      const view = setup()
      await act(async () => {
        view.result.current.actions.openFile('folder', `${uri}/readme.md`)
      })
      if (transition === 'unmount') {
        view.unmount()
      } else if (transition === 'close') {
        view.nodesRef.current = []
      } else {
        view.result.current.actions.updateFolder('folder', {
          ...folder().data.folder!,
          uri: 'file:///repo',
        })
      }
      await act(async () => {
        finish({ kind: 'file' })
      })
      expect(view.createDocumentNode).not.toHaveBeenCalled()
    },
  )

  it('keeps node identity and binding while navigating and cannot change its root', () => {
    const view = setup()
    view.result.current.actions.updateFolder('folder', {
      ...folder().data.folder!,
      uri: 'file:///repo',
      viewMode: 'list',
    })
    expect(view.nodesRef.current[0]).toMatchObject({
      id: 'folder',
      data: {
        title: 'repo',
        workerBinding: { endpointId: 'local', mountId: null },
        folder: { uri: 'file:///repo', viewMode: 'list' },
      },
    })
    view.result.current.actions.updateFolder('folder', {
      uri: 'file:///elsewhere',
      rootUri: 'file:///',
      viewMode: 'icons',
      expandedDirectoryUris: [],
    })
    expect(view.nodesRef.current[0].data.folder?.rootUri).toBe('file:///repo')
  })

  it('preserves freshly navigated browser state against an in-flight older worker snapshot', () => {
    const view = setup()
    const original: WorkspaceState = {
      id: 'one',
      name: 'Project',
      path: '/repo',
      worktreesRoot: '',
      nodes: [folder()],
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: false,
      spaces: [],
      activeSpaceId: null,
      spaceArchiveRecords: [],
    }
    const stale = toPersistedState([original], original.id).workspaces[0]
    view.result.current.actions.updateFolder('folder', {
      ...folder().data.folder!,
      uri: 'file:///repo',
      viewMode: 'list',
      expandedDirectoryUris: [uri],
    })
    const current = { ...original, nodes: view.nodesRef.current }
    const merged = toShellWorkspaceStateForSync(stale, current)
    expect(merged.nodes[0]).toBe(view.nodesRef.current[0])
    expect(merged.nodes[0].data.folder).toMatchObject({
      uri: 'file:///repo',
      viewMode: 'list',
      expandedDirectoryUris: [uri],
    })
  })

  it('initializes collapsed presentation before publishing a folder with expanded dimensions', () => {
    const nodesRef = { current: [] as Node<TerminalNodeData>[] }
    let compactAtPublish = false
    const view = renderHook(() =>
      useWorkspaceCanvasFilesystemNodeCreation({
        nodesRef,
        spacesRef: { current: [] },
        standardWindowSizeBucket: 'regular',
        setNodes: update => {
          nodesRef.current = update(nodesRef.current)
          compactAtPublish =
            useCanvasCollapseStore.getState().workspaces.one?.collapsedNodeIds[
              nodesRef.current[0].id
            ] === true
        },
      }),
    )
    act(() => {
      view.result.current.createFolderNode(
        { x: 100, y: 100 },
        folder().data.folder!,
        { endpointId: 'local', mountId: null },
        'one',
      )
    })
    expect(compactAtPublish).toBe(true)
    expect(nodesRef.current[0].data.kind).toBe('folder')
    expect(nodesRef.current[0].data.width).toBeGreaterThan(128)
    expect(nodesRef.current[0].data.height).toBeGreaterThan(112)
  })

  it.each([true, false])(
    'uses visible obstacle dimensions when a sibling is collapsed=%s',
    collapsed => {
      const sibling = { ...folder(), position: { x: 100, y: 100 } }
      const nodesRef = { current: [sibling] }
      useCanvasCollapseStore.setState({
        workspaces: {
          one: { collapsedNodeIds: collapsed ? { folder: true } : {}, collapsedSpaceIds: {} },
        },
      })
      const view = renderHook(() =>
        useWorkspaceCanvasFilesystemNodeCreation({
          nodesRef,
          spacesRef: { current: [] },
          standardWindowSizeBucket: 'regular',
          setNodes: update => {
            nodesRef.current = update(nodesRef.current)
          },
        }),
      )
      act(() => {
        view.result.current.createFolderNode(
          { x: 300, y: 150 },
          folder().data.folder!,
          { endpointId: 'local', mountId: null },
          'one',
        )
      })
      expect(nodesRef.current).toHaveLength(2)
      if (collapsed) {
        expect(nodesRef.current[1].position).toEqual({ x: 300, y: 150 })
      } else {
        expect(nodesRef.current[1].position).not.toEqual({ x: 300, y: 150 })
      }
      expect(nodesRef.current[0]).toBe(sibling)
      expect(nodesRef.current[1].data.width).toBeGreaterThan(128)
    },
  )
})
