import { act } from '@testing-library/react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MountDto } from '@shared/contracts/dto'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { replaceWorkspaceSpaces } from '../../../store/workspaceDocumentCommands'
import { useCanvasSelectionCommands, useCanvasUiCommands } from '../../../store/canvasStoreContext'
import { useWorkspaceCanvasSpaces } from './useSpaces'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasDocumentHarness,
} from '../../../../../../../../tests/support/canvasDocumentHarness'
import {
  createRowNodes,
  createSpace,
} from '../../../../../../../../tests/support/canvasSelectionFixtures'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

function space(id: string, nodeIds: string[] = [], x = 0): WorkspaceSpaceState {
  return {
    ...createSpace(id, { x, y: 0, width: 600, height: 400 }, nodeIds),
    directoryPath: WORKSPACE_PATH,
  }
}

function renderSpaces(harness: CanvasDocumentHarness) {
  const reactFlow = {
    setViewport: vi.fn(),
    fitView: vi.fn(),
    getNodes: () => [] as Node<TerminalNodeData>[],
  }
  const view = renderCanvasNodeStore(harness, {
    workspacePath: WORKSPACE_PATH,
    extend: ({ nodeStore, nodes, spaces }) => ({
      spacesApi: useWorkspaceCanvasSpaces({
        workspaceId: harness.workspaceId,
        activeSpaceId: null,
        onActiveSpaceChange: vi.fn(),
        workspacePath: WORKSPACE_PATH,
        focusNodeTargetZoom: 1,
        standardWindowSizeBucket: 'regular',
        reactFlow: reactFlow as unknown as ReactFlowInstance<Node<TerminalNodeData>>,
        nodes,
        updateCanvasDocument: nodeStore.updateCanvasDocument,
        spaces,
        onShowMessage: vi.fn(),
      }),
      ui: useCanvasUiCommands(),
      selection: useCanvasSelectionCommands(),
    }),
  })
  return { ...view, reactFlow }
}

// The Space hooks read the committed document when a handler runs. Every case writes the store
// and calls the handler in one act, before React could commit the write to a render.
describe('useWorkspaceCanvasSpaces reads and writes the committed document', () => {
  beforeEach(() => {
    vi.stubGlobal('opencoveApi', {
      controlSurface: { invoke: vi.fn().mockResolvedValue({ mounts: [mount] }) },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('renames the store Space and keeps a Space that a write added in the same act', () => {
    const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
    const view = renderSpaces(harness)
    act(() => {
      view.result.current.ui.startSpaceRename('space-a', 'Old')
      view.result.current.ui.setSpaceRenameDraft('Renamed')
    })

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        space('space-late', [], 700),
      ])
      view.result.current.spacesApi.commitSpaceRename('space-a')
    })

    expect(harness.readStoreDocument().spaces.map(item => [item.id, item.name])).toEqual([
      ['space-a', 'Renamed'],
      ['space-late', 'space-late'],
    ])
  })

  it('creates a Space from a selection in one store update and moves the nodes', async () => {
    const nodes = createRowNodes(['a', 'b'])
    const harness = createCanvasDocumentHarness({ nodes })
    const view = renderSpaces(harness)
    act(() => view.result.current.selection.setNodeIds(['a']))
    harness.notifications.mockClear()

    await act(async () => {
      view.result.current.spacesApi.createSpaceFromSelectedNodes()
    })

    const document = harness.readStoreDocument()
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(document.spaces).toHaveLength(1)
    expect(document.spaces[0].nodeIds).toEqual(['a'])
    // The new Space pushed the node beside it to the right of its rect.
    const created = document.spaces[0].rect
    expect(created).not.toBeNull()
    expect(document.nodes.find(node => node.id === 'b')?.position.x).toBeGreaterThanOrEqual(
      (created?.x ?? 0) + (created?.width ?? 0),
    )
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('creates a child Space in one store update and returns its id', () => {
    const terminals = createRowNodes(['t1']).map(node => ({
      ...node,
      data: { ...node.data, kind: 'terminal' as const, sessionId: 'session-t1' },
      position: { x: 40, y: 40 },
    }))
    const harness = createCanvasDocumentHarness({
      nodes: terminals,
      spaces: [space('parent', ['t1'])],
    })
    const view = renderSpaces(harness)
    harness.notifications.mockClear()
    let childId: string | null = null

    act(() => {
      childId = view.result.current.spacesApi.createChildSpaceInParent('parent', {
        nodeIds: ['t1'],
      })
    })

    const document = harness.readStoreDocument()
    expect(childId).toEqual(expect.any(String))
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(document.spaces.find(item => item.id === childId)?.nodeIds).toEqual(['t1'])
    expect(document.nodes[0].data.expectedDirectory).toBe(WORKSPACE_PATH)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('flushes for a label colour and not for a rename', () => {
    const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
    const view = renderSpaces(harness)

    act(() => view.result.current.spacesApi.setSpaceLabelColor('space-a', 'blue'))
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().spaces[0].labelColor).toBe('blue')

    act(() => {
      view.result.current.ui.startSpaceRename('space-a', 'Old')
      view.result.current.ui.setSpaceRenameDraft('Renamed')
    })
    act(() => view.result.current.spacesApi.commitSpaceRename('space-a'))
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().spaces[0].name).toBe('Renamed')
  })

  it('focuses a Space that was written in the same act', () => {
    const harness = createCanvasDocumentHarness({ spaces: [space('space-a')] })
    const view = renderSpaces(harness)
    let focused = false

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        space('space-late', [], 900),
      ])
      focused = view.result.current.spacesApi.focusSpaceInViewport('space-late')
    })

    expect(focused).toBe(true)
    expect(view.reactFlow.setViewport).toHaveBeenCalledTimes(1)
  })
})
