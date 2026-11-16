import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useScrollbackStore } from '../../../src/contexts/workspace/presentation/renderer/store/useScrollbackStore'
import {
  replaceWorkspaceNodes,
  replaceWorkspaceSpaces,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  agentNode,
  documentOf,
  renderInTwoWorkspaces,
  stubOpencoveApi,
  taskNode,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
  type RuntimeCanvasContext,
} from '../../support/agentRuntimeHarness'
import {
  ANCHOR,
  blockerNode,
  COLLAPSED_CREATIONS,
  CREATIONS,
} from '../../support/nodeStoreCreations'
import { getCollapsedNodeSize } from '../../../src/contexts/workspace/presentation/renderer/utils/canvasCollapse'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

// The node store reads the nodes it closes, scrolls and focuses, and its creators read the nodes
// and the Spaces they place against, from the committed document as the store holds it when they
// run (#702, PR 13), not from the canvas view's copy. A node that only the store holds is the case
// that tells the two apart: a store write in the same `act` before the call, or a node created
// while another workspace is displayed (the canvas shows only the displayed workspace).

const currentFlow = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('@xyflow/react', async importOriginal => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => currentFlow.value,
}))

vi.mock('@contexts/plugins/presentation/renderer/usePluginRegistry', () => ({
  getPluginManifest: (pluginId: string) => ({
    id: pluginId,
    enabled: true,
    nodeKinds: ['plugin'],
    view: { minWidth: 100, minHeight: 100 },
  }),
}))

const NO_NODES: Node<TerminalNodeData>[] = []
const kill = vi.fn(async () => undefined)
const deleteCanvasImage = vi.fn(async () => undefined)
const closeWebsiteWindow = vi.fn(async () => undefined)
const setCenter = vi.fn(async () => true)

beforeEach(() => {
  vi.clearAllMocks()
  currentFlow.value = {
    viewportInitialized: true,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setCenter,
    setViewport: vi.fn(),
    getNode: () => undefined,
  }
  stubOpencoveApi({
    pty: { kill },
    workspace: { deleteCanvasImage },
    websiteWindow: { close: closeWebsiteWindow },
  })
  useScrollbackStore.getState().clearAllScrollbacks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type View = ReturnType<typeof renderInTwoWorkspaces<RuntimeCanvasContext>>['view']
const displayB = () => act(() => useAppStore.setState({ activeWorkspaceId: B }))
const store = (view: View) => view.result.current.nodeStore

function renderStore(documents: Parameters<typeof renderInTwoWorkspaces>[1] = {}) {
  return renderInTwoWorkspaces(context => context, documents)
}

function overlaps(
  node: Node<TerminalNodeData>,
  other: { position: { x: number; y: number }; width: number; height: number },
  presented: { width: number; height: number } = node.data,
): boolean {
  return (
    node.position.x < other.position.x + other.width &&
    node.position.x + presented.width > other.position.x &&
    node.position.y < other.position.y + other.height &&
    node.position.y + presented.height > other.position.y
  )
}

const overlapsBlocked = (name: string, node: Node<TerminalNodeData>) =>
  overlaps(node, BLOCKED, COLLAPSED_CREATIONS.has(name) ? getCollapsedNodeSize() : node.data)

const BLOCKED = { position: { x: 0, y: 0 }, width: 1200, height: 900 }
const LATE_SPACE: WorkspaceSpaceState = {
  id: 'space-late',
  name: 'Late',
  directoryPath: '/late',
  targetMountId: null,
  labelColor: null,
  nodeIds: [],
  rect: { ...BLOCKED.position, width: BLOCKED.width, height: BLOCKED.height },
}

describe('closeNode', () => {
  it('kills the runtime of a node that was added to the store in the same act', async () => {
    const { view } = renderStore({ a: { nodes: [] } })

    await act(async () => {
      replaceWorkspaceNodes(A, [pixelNode({ sessionId: 'pty-late' })])
      await store(view).closeNode('terminal-1')
    })

    expect(kill).toHaveBeenCalledExactlyOnceWith({ sessionId: 'pty-late' })
    expect(documentOf(A).nodes).toEqual([])
  })

  it('deletes the image asset and closes the window of nodes only the store holds', async () => {
    const { view } = renderStore({ a: { nodes: [] } })
    const image = pixelNode({
      kind: 'image',
      sessionId: '',
      image: {
        assetId: 'asset-late',
        mimeType: 'image/png',
        fileName: null,
        naturalWidth: 1,
        naturalHeight: 1,
      },
    })

    await act(async () => {
      replaceWorkspaceNodes(A, [
        { ...image, id: 'image-late' },
        { ...pixelNode({ kind: 'website', sessionId: '' }), id: 'website-late' },
      ])
      await store(view).closeNode('image-late')
      await store(view).closeNode('website-late')
    })

    expect(deleteCanvasImage).toHaveBeenCalledExactlyOnceWith({ assetId: 'asset-late' })
    expect(closeWebsiteWindow).toHaveBeenCalledExactlyOnceWith({ nodeId: 'website-late' })
  })

  it('unlinks the task of an agent that only the store holds', async () => {
    const { view } = renderStore({ a: { nodes: [] } })

    await act(async () => {
      replaceWorkspaceNodes(A, [
        agentNode('agent-late', {}, { taskId: 'task-late' }),
        taskNode('task-late', 'agent-late'),
      ])
      await store(view).closeNode('agent-late')
    })

    const task = documentOf(A).nodes.find(node => node.id === 'task-late')
    expect(task?.data.task?.linkedAgentNodeId).toBeNull()
    expect(task?.data.task?.agentSessions).toHaveLength(1)
  })

  it('reads the workspace of its render while another workspace is displayed', async () => {
    const { view } = renderStore({
      a: { nodes: [] },
      b: { nodes: [pixelNode({ sessionId: 'pty-of-b' })] },
    })
    displayB()

    await act(async () => {
      replaceWorkspaceNodes(A, [pixelNode({ sessionId: 'pty-of-a' })])
      await store(view).closeNode('terminal-1')
    })

    expect(kill).toHaveBeenCalledExactlyOnceWith({ sessionId: 'pty-of-a' })
  })
})

describe('updateNodeScrollback', () => {
  const scrollbackOf = (nodeId: string) => useScrollbackStore.getState().scrollbackByNodeId[nodeId]

  it('stores the scrollback of a node that was added to the store in the same act', () => {
    const { view } = renderStore({ a: { nodes: [] } })

    act(() => {
      replaceWorkspaceNodes(A, [pixelNode({ sessionId: 'pty-late' })])
      store(view).updateNodeScrollback('terminal-1', 'late output')
    })

    expect(scrollbackOf('terminal-1')).toBe('late output')
  })

  it('keeps the scrollback of such a node pending while a node is being dragged', () => {
    const { view } = renderStore({ a: { nodes: [] } })

    act(() => {
      replaceWorkspaceNodes(A, [pixelNode({ sessionId: 'pty-late' })])
      store(view).isNodeDraggingRef.current = true
      store(view).updateNodeScrollback('terminal-1', 'late output')
    })

    expect(scrollbackOf('terminal-1')).toBeUndefined()
    expect(store(view).pendingScrollbackByNodeRef.current.get('terminal-1')).toBe('late output')
  })

  it('ignores a task node of the store that the canvas view still shows as a terminal', () => {
    const { view } = renderStore({ a: { nodes: [pixelNode()] } })

    act(() => {
      replaceWorkspaceNodes(A, [{ ...taskNode('terminal-1', 'x') }])
      store(view).updateNodeScrollback('terminal-1', 'output')
    })

    expect(scrollbackOf('terminal-1')).toBeUndefined()
  })

  it('reads the workspace that is shown after a switch', () => {
    const { view, showB } = renderStore({
      a: { nodes: [pixelNode()] },
      b: { nodes: [{ ...taskNode('terminal-1', 'x') }] },
    })
    showB()

    act(() => {
      store(view).updateNodeScrollback('terminal-1', 'output of b')
    })

    expect(scrollbackOf('terminal-1')).toBeUndefined()
  })

  it('reads the workspace of its render while another workspace is displayed', () => {
    const { view } = renderStore({
      a: { nodes: [] },
      b: { nodes: [{ ...taskNode('terminal-1', 'x') }] },
    })
    displayB()

    act(() => {
      replaceWorkspaceNodes(A, [pixelNode()])
      store(view).updateNodeScrollback('terminal-1', 'output of a')
    })

    expect(scrollbackOf('terminal-1')).toBe('output of a')
  })
})

describe('the focus of a created node when no handler is given', () => {
  // The canvas view of this store never shows a node, so a node it creates is the store's alone.
  function renderStoreWithoutView() {
    createCanvasDocumentHarness({ workspaceId: A })
    return renderInCanvasDocument(
      () =>
        useWorkspaceCanvasNodesStore({
          workspaceId: A,
          workspacePath: `/tmp/${A}`,
          nodes: NO_NODES,
          spacesRef: { current: [] },
          onNodesCommitted: vi.fn(),
          isLiveGestureActive: () => false,
          standardWindowSizeBucket: 'regular',
          browserDefaultMode: 'iframe',
        }),
      { workspaceId: A },
    )
  }

  it('finds a node that the store holds and the canvas view does not show', () => {
    const view = renderStoreWithoutView()
    setCenter.mockClear()

    act(() => {
      view.result.current.createNoteNode({ x: 2400, y: 1800 })
    })

    expect(documentOf(A).nodes).toHaveLength(1)
    expect(setCenter).toHaveBeenCalledTimes(1)
  })

  it('finds the node of its own render while another workspace is displayed', () => {
    const view = renderStoreWithoutView()
    displayB()
    setCenter.mockClear()

    act(() => {
      view.result.current.createNoteNode({ x: 2400, y: 1800 })
    })

    expect(setCenter).toHaveBeenCalledTimes(1)
  })
})

async function create(view: View, name: string): Promise<Node<TerminalNodeData>> {
  let created: unknown = null
  await act(async () => {
    created = await CREATIONS[name](view.result.current)
  })
  if (!created) {
    throw new Error(`${name} was not created`)
  }
  return created as Node<TerminalNodeData>
}

describe.each(Object.keys(CREATIONS))('creating %s', name => {
  it('places it away from a node that was added to the store in the same act', async () => {
    const { view } = renderStore({ a: { nodes: [] } })

    let created: Node<TerminalNodeData> | null = null
    await act(async () => {
      replaceWorkspaceNodes(A, [blockerNode()])
      created = (await CREATIONS[name](view.result.current)) as Node<TerminalNodeData>
    })

    expect(created).not.toBeNull()
    expect(overlapsBlocked(name, created!)).toBe(false)
  })

  it('places it away from a Space that was added to the store in the same act', async () => {
    const { view } = renderStore({ a: { nodes: [] } })
    let created: Node<TerminalNodeData> | null = null
    await act(async () => {
      replaceWorkspaceSpaces(A, [LATE_SPACE])
      created = (await CREATIONS[name](view.result.current)) as Node<TerminalNodeData>
    })

    expect(created).not.toBeNull()
    expect(overlapsBlocked(name, created!)).toBe(false)
  })

  it('places it away from a Space of its render while another workspace is displayed', async () => {
    const { view } = renderStore({ a: { spaces: [LATE_SPACE] }, b: {} })
    displayB()

    const created = await create(view, name)

    expect(overlapsBlocked(name, created)).toBe(false)
  })

  it('places it against the workspace that is shown after a switch', async () => {
    const { view, showB } = renderStore({ a: {}, b: { nodes: [blockerNode()] } })
    showB()

    const created = await create(view, name)

    expect(overlapsBlocked(name, created)).toBe(false)
  })

  it('places it against the workspace of its render while another workspace is displayed', async () => {
    const { view } = renderStore({ a: { nodes: [blockerNode()] }, b: {} })
    displayB()

    const created = await create(view, name)

    expect(overlapsBlocked(name, created)).toBe(false)
  })
})

describe('placement during a node drag', () => {
  it('avoids the dragged node at the position the store holds, not its live position', async () => {
    const dragged = blockerNode('dragged', { width: 400, height: 300 })
    const { view } = renderStore({ a: { nodes: [dragged] } })

    // A live drag moves the canvas view's copy; the store keeps the committed position.
    act(() => {
      const { canvasState } = view.result.current
      canvasState.hasTransientNodePositionsRef.current = true
      canvasState.setCanvasNodes([{ ...dragged, position: { x: 4000, y: 0 } }])
    })
    expect(view.result.current.canvasState.flowNodes[0].position.x).toBe(4000)

    const created = await create(view, 'a note')

    expect(overlaps(created, { position: { x: 0, y: 0 }, width: 400, height: 300 })).toBe(false)
  })
})

describe('the plugin window creation', () => {
  const invoke = vi.fn((_request: unknown) => new Promise<never>(() => undefined))

  beforeEach(() => {
    invoke.mockClear()
    stubOpencoveApi({ controlSurface: { invoke } })
  })

  it('opens the window in a Space that was added to the store in the same act', async () => {
    const { view } = renderStore({ a: { nodes: [] } })
    act(() => {
      replaceWorkspaceSpaces(A, [LATE_SPACE])
      store(view).createPluginNode(ANCHOR, 'plugin-1')
    })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][0]).toMatchObject({
      payload: { pluginId: 'plugin-1', projectId: A, spaceId: 'space-late' },
    })
  })

  it('reads the Spaces of its render while another workspace is displayed', () => {
    const space: WorkspaceSpaceState = {
      id: 'space-of-a',
      name: 'A',
      directoryPath: '/a',
      targetMountId: null,
      labelColor: null,
      nodeIds: [],
      rect: { x: 0, y: 0, width: 1200, height: 900 },
    }
    const { view } = renderStore({ a: { spaces: [space] }, b: {} })
    displayB()

    act(() => {
      store(view).createPluginNode(ANCHOR, 'plugin-1')
    })

    expect(invoke.mock.calls[0][0]).toMatchObject({ payload: { spaceId: 'space-of-a' } })
  })
})
