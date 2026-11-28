import { act } from '@testing-library/react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MountDto } from '@shared/contracts/dto'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  useCanvasSelectionCommands,
  useCanvasUiCommands,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { useWorkspaceCanvasSpaces } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaces'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasDocumentHarness,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import { createSpace } from '../../support/canvasSelectionFixtures'
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

vi.mock('@app/renderer/i18n', () => ({
  // Interpolate count so resolveDefaultSpaceName terminates when a second Space is created.
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}-${options.count}`,
  }),
}))

const WORKSPACE_PATH = '/tmp/workspace-1'
const mount: MountDto = {
  mountId: 'mount-1',
  projectId: 'workspace-1',
  endpointId: 'local',
  targetId: 'target-1',
  rootPath: WORKSPACE_PATH,
  rootUri: `file://${WORKSPACE_PATH}`,
  name: 'Local',
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
}

function folderNode(id: string, uri: string): Node<TerminalNodeData> {
  return {
    ...pixelNode(),
    id,
    position: { x: 0, y: 0 },
    data: {
      ...pixelNode().data,
      kind: 'folder',
      folder: { uri, rootUri: uri, viewMode: 'icons', expandedDirectoryUris: [] },
    },
  } as unknown as Node<TerminalNodeData>
}

function space(id: string, nodeIds: string[] = []): WorkspaceSpaceState {
  return {
    ...createSpace(id, { x: 0, y: 0, width: 600, height: 400 }, nodeIds),
    directoryPath: WORKSPACE_PATH,
  }
}

const reactFlow = {
  setViewport: vi.fn(),
  fitView: vi.fn(),
  getNodes: () => [] as Node<TerminalNodeData>[],
}

const onActiveSpaceChange = vi.fn()
const onShowMessage = vi.fn()

function useSpacesUnderTest({ workspaceId, nodeStore, nodes, spaces }: CanvasNodeStoreContext) {
  return {
    spacesApi: useWorkspaceCanvasSpaces({
      workspaceId,
      activeSpaceId: null,
      onActiveSpaceChange,
      workspacePath: WORKSPACE_PATH,
      focusNodeTargetZoom: 1,
      standardWindowSizeBucket: 'regular',
      reactFlow: reactFlow as unknown as ReactFlowInstance<Node<TerminalNodeData>>,
      nodes,
      spaces,
      onShowMessage,
    }),
    ui: useCanvasUiCommands(),
    selection: useCanvasSelectionCommands(),
    nodeStore,
  }
}

function renderSpaces(harness: CanvasDocumentHarness) {
  onShowMessage.mockClear()
  return renderCanvasNodeStore(harness, {
    workspacePath: WORKSPACE_PATH,
    extend: useSpacesUnderTest,
  })
}

function stubMountInvoke(invoke: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
}

describe('useWorkspaceCanvasSpaces.createSpaceFromNodeDirectory', () => {
  beforeEach(() => {
    stubMountInvoke(vi.fn().mockResolvedValue({ mounts: [mount] }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('writes a top-level Space bound to the folder directory and its mount', async () => {
    const harness = createCanvasDocumentHarness({
      nodes: [folderNode('folder-1', `file://${WORKSPACE_PATH}/src`)],
    })
    const view = renderSpaces(harness)

    await act(async () => {
      view.result.current.spacesApi.createSpaceFromNodeDirectory('folder-1')
    })

    const document = harness.readStoreDocument()
    expect(document.spaces).toHaveLength(1)
    expect(document.spaces[0].nodeIds).toEqual(['folder-1'])
    expect(document.spaces[0].targetMountId).toBe('mount-1')
    expect(document.spaces[0].directoryPath).toBe(`${WORKSPACE_PATH}/src`)
    expect(onShowMessage).not.toHaveBeenCalled()
  })

  it('warns and writes nothing when the directory is outside every mount', async () => {
    const harness = createCanvasDocumentHarness({
      nodes: [folderNode('folder-1', 'file:///elsewhere/src')],
    })
    const view = renderSpaces(harness)

    await act(async () => {
      view.result.current.spacesApi.createSpaceFromNodeDirectory('folder-1')
    })

    expect(harness.readStoreDocument().spaces).toHaveLength(0)
    expect(onShowMessage).toHaveBeenCalledWith('messages.spaceDirectoryOutsideMounts', 'warning')
  })

  it('writes nothing when the canvas unmounts while mount.list resolves', async () => {
    let resolveMounts: (value: { mounts: MountDto[] }) => void = () => {}
    stubMountInvoke(
      vi.fn().mockImplementation(
        () =>
          new Promise<{ mounts: MountDto[] }>(resolve => {
            resolveMounts = resolve
          }),
      ),
    )
    const harness = createCanvasDocumentHarness({
      nodes: [folderNode('folder-1', `file://${WORKSPACE_PATH}/src`)],
    })
    const view = renderSpaces(harness)

    act(() => {
      view.result.current.spacesApi.createSpaceFromNodeDirectory('folder-1')
    })
    view.unmount()
    await act(async () => {
      resolveMounts({ mounts: [mount] })
    })

    expect(harness.readStoreDocument().spaces).toHaveLength(0)
    expect(onShowMessage).not.toHaveBeenCalled()
  })

  it('writes nothing for a node a Space already owns', async () => {
    const harness = createCanvasDocumentHarness({
      nodes: [folderNode('folder-1', `file://${WORKSPACE_PATH}/src`)],
      spaces: [space('space-a', ['folder-1'])],
    })
    const view = renderSpaces(harness)

    await act(async () => {
      view.result.current.spacesApi.createSpaceFromNodeDirectory('folder-1')
    })

    expect(harness.readStoreDocument().spaces).toHaveLength(1)
    expect(harness.readStoreDocument().spaces[0].id).toBe('space-a')
    expect(onShowMessage).toHaveBeenCalledWith('messages.spaceNodeHasNoDirectory', 'warning')
  })

  it('writes nothing for a document node', async () => {
    const documentNode = {
      ...pixelNode(),
      id: 'doc-1',
      data: {
        ...pixelNode().data,
        kind: 'document',
        document: { uri: `file://${WORKSPACE_PATH}/src/file.ts` },
      },
    } as unknown as Node<TerminalNodeData>
    const harness = createCanvasDocumentHarness({ nodes: [documentNode] })
    const view = renderSpaces(harness)

    await act(async () => {
      view.result.current.spacesApi.createSpaceFromNodeDirectory('doc-1')
    })

    expect(harness.readStoreDocument().spaces).toHaveLength(0)
    expect(onShowMessage).toHaveBeenCalledWith('messages.spaceNodeHasNoDirectory', 'warning')
  })

  it('leaves one Space owning the folder when the item is clicked twice before mount.list answers', async () => {
    let resolveMounts: (value: { mounts: MountDto[] }) => void = () => {}
    const pending = new Promise<{ mounts: MountDto[] }>(resolve => {
      resolveMounts = resolve
    })
    stubMountInvoke(vi.fn().mockReturnValue(pending))
    const harness = createCanvasDocumentHarness({
      nodes: [folderNode('folder-1', `file://${WORKSPACE_PATH}/src`)],
    })
    const view = renderSpaces(harness)

    act(() => {
      view.result.current.spacesApi.createSpaceFromNodeDirectory('folder-1')
      view.result.current.spacesApi.createSpaceFromNodeDirectory('folder-1')
    })
    await act(async () => {
      resolveMounts({ mounts: [mount] })
    })

    const spaces = harness.readStoreDocument().spaces
    expect(spaces).toHaveLength(1)
    expect(spaces[0].nodeIds).toEqual(['folder-1'])
  })

  it('writes nothing when the folder is moved into a Space while mount.list is pending', async () => {
    let resolveMounts: (value: { mounts: MountDto[] }) => void = () => {}
    const pending = new Promise<{ mounts: MountDto[] }>(resolve => {
      resolveMounts = resolve
    })
    stubMountInvoke(vi.fn().mockReturnValue(pending))
    const harness = createCanvasDocumentHarness({
      nodes: [folderNode('folder-1', `file://${WORKSPACE_PATH}/src`)],
    })
    const view = renderSpaces(harness)

    act(() => {
      view.result.current.spacesApi.createSpaceFromNodeDirectory('folder-1')
    })
    act(() => {
      replaceSpacesInStore(harness.workspaceId, [space('space-a', ['folder-1'])])
    })
    await act(async () => {
      resolveMounts({ mounts: [mount] })
    })

    const spaces = harness.readStoreDocument().spaces
    expect(spaces).toHaveLength(1)
    expect(spaces[0].id).toBe('space-a')
    expect(spaces[0].nodeIds).toEqual(['folder-1'])
  })
})
