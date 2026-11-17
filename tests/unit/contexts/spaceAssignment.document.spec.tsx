import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useCanvasCollapseStore } from '../../../src/contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import { EMPTY_CANVAS_COLLAPSE } from '../../../src/contexts/workspace/presentation/renderer/utils/canvasCollapse'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import {
  readWorkspaceDocument,
  replaceWorkspaceNodes,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import {
  useWorkspaceCanvasStoreNodes,
  replaceSpacesInStore,
} from '../../support/workspaceCanvasStoreHarness'

// The push-away that follows a node creation reads the document when it writes and writes the
// moved nodes and the pushed Spaces in one store update (#702, PR 6). The node was already added
// to the store by its creator, which flushed.

type Assign = Parameters<typeof assignNodeToSpaceAndExpand>[0]
type Updater = Assign['updateCanvasDocument']

// The nodes carry the initial size that the node store would otherwise add with its first write.
function node(
  id: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
): Node<TerminalNodeData> {
  return {
    id,
    position,
    initialWidth: size.width,
    initialHeight: size.height,
    data: { width: size.width, height: size.height } as TerminalNodeData,
  }
}

function space(overrides: Partial<WorkspaceSpaceState> = {}): WorkspaceSpaceState {
  return {
    id: 'space-a',
    name: 'Space A',
    directoryPath: '/workspace',
    targetMountId: null,
    labelColor: null,
    nodeIds: ['seed-note'],
    rect: { x: 200, y: 200, width: 480, height: 320 },
    ...overrides,
  }
}

const seedNote = node('seed-note', { x: 240, y: 240 }, { width: 420, height: 280 })
// Reaches to the right, so the Space grows to about x = 1224 and meets the bystander.
const wide = node('wide', { x: 500, y: 240 }, { width: 700, height: 300 })
const bystander = node('bystander', { x: 1100, y: 250 }, { width: 200, height: 100 })

function assign(updateCanvasDocument: Updater, input: Omit<Assign, 'updateCanvasDocument'>) {
  assignNodeToSpaceAndExpand({ ...input, updateCanvasDocument })
}

function setup(nodes: Node<TerminalNodeData>[], spaces: WorkspaceSpaceState[]) {
  const harness = createCanvasDocumentHarness({ nodes, spaces })
  const view = renderCanvasNodeStore(harness)
  return { harness, view, update: () => view.result.current.nodeStore.updateCanvasDocument }
}

function storedNode(
  harness: ReturnType<typeof createCanvasDocumentHarness>,
  id: string,
): Node<TerminalNodeData> {
  return harness.readStoreDocument().nodes.find(item => item.id === id)!
}

const layoutSyncs = vi.fn()

function listenForLayoutSync() {
  layoutSyncs.mockClear()
  window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, layoutSyncs)
}

afterEach(() => {
  window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, layoutSyncs)
  useCanvasCollapseStore.setState(useCanvasCollapseStore.getInitialState(), true)
})

describe('assignNodeToSpaceAndExpand as one store write', () => {
  it('writes the moved positions and the pushed Spaces in one store notification', () => {
    const { harness, update } = setup([seedNote, wide, bystander], [space()])
    listenForLayoutSync()
    harness.notifications.mockClear()

    act(() => {
      assign(update(), {
        workspaceId: harness.workspaceId,
        createdNodeId: wide.id,
        createdNode: wide,
        targetSpaceId: 'space-a',
      })
    })

    const [stored] = harness.readStoreDocument().spaces
    expect(stored.nodeIds).toEqual(['seed-note', 'wide'])
    expect(stored.rect!.x + stored.rect!.width).toBeGreaterThanOrEqual(1200)
    const pushed = storedNode(harness, 'bystander')
    expect(pushed.position.x).toBeGreaterThanOrEqual(stored.rect!.x + stored.rect!.width)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    // The push-away never flushes and never asks the terminals to re-fit.
    expect(harness.flush).not.toHaveBeenCalled()
    expect(layoutSyncs).not.toHaveBeenCalled()
  })

  it('pushes a node that a non-canvas writer stored earlier in the same call', () => {
    const { harness, update } = setup([seedNote, wide], [space()])
    listenForLayoutSync()

    act(() => {
      // The canvas copy of the nodes lags this write until React renders again.
      replaceWorkspaceNodes(harness.workspaceId, [...harness.readStoreDocument().nodes, bystander])
      assign(update(), {
        workspaceId: harness.workspaceId,
        createdNodeId: wide.id,
        createdNode: wide,
        targetSpaceId: 'space-a',
      })
    })

    const [stored] = harness.readStoreDocument().spaces
    expect(storedNode(harness, 'bystander').position.x).toBeGreaterThanOrEqual(
      stored.rect!.x + stored.rect!.width,
    )
  })

  it('pushes a node that was stored between two assignments of the same call', () => {
    // The second node reaches further to the right than the first, so the Space grows again.
    const wider = node('wider', { x: 1000, y: 240 }, { width: 700, height: 300 })
    const farBystander = node('bystander', { x: 1500, y: 250 }, { width: 200, height: 100 })
    const { harness, update } = setup([seedNote, wide, wider], [space()])
    const assignCreated = (created: Node<TerminalNodeData>) =>
      assign(update(), {
        workspaceId: harness.workspaceId,
        createdNodeId: created.id,
        createdNode: created,
        targetSpaceId: 'space-a',
      })

    act(() => {
      assignCreated(wide)
      // Nothing was in the way of the first assignment; this node is stored after it.
      replaceWorkspaceNodes(harness.workspaceId, [
        ...harness.readStoreDocument().nodes,
        farBystander,
      ])
      assignCreated(wider)
    })

    const [stored] = harness.readStoreDocument().spaces
    expect(stored.rect!.x + stored.rect!.width).toBeGreaterThanOrEqual(1700)
    expect(storedNode(harness, 'bystander').position.x).toBeGreaterThanOrEqual(
      stored.rect!.x + stored.rect!.width,
    )
  })

  it('writes only the Spaces when no node moves, and keeps the node array and the terminals', () => {
    const inside = node('inside', { x: 300, y: 300 }, { width: 100, height: 100 })
    const roomy = { x: 200, y: 200, width: 800, height: 600 }
    const { harness, update } = setup([seedNote, inside], [space({ rect: roomy })])
    listenForLayoutSync()
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()

    act(() => {
      assign(update(), {
        workspaceId: harness.workspaceId,
        createdNodeId: inside.id,
        createdNode: inside,
        targetSpaceId: 'space-a',
      })
    })

    const document = harness.readStoreDocument()
    expect(document.spaces[0].nodeIds).toEqual(['seed-note', 'inside'])
    expect(document.spaces[0].rect).toEqual(roomy)
    expect(document.nodes).toBe(nodesBefore)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(layoutSyncs).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('keeps the node array when the collapse projection restores hidden nodes in place', () => {
    // A collapsed Space hides its node: the layout restores that node's own position, so the move
    // list is not empty although nothing moves.
    const hidden = node('hidden-note', { x: 3000, y: 3000 }, { width: 100, height: 100 })
    const collapsedSpace = space({
      id: 'space-hidden',
      nodeIds: ['hidden-note'],
      rect: { x: 2900, y: 2900, width: 400, height: 400 },
    })
    const inside = node('inside', { x: 300, y: 300 }, { width: 100, height: 100 })
    const roomy = { x: 200, y: 200, width: 800, height: 600 }
    const { harness, update } = setup(
      [seedNote, inside, hidden],
      [space({ rect: roomy }), collapsedSpace],
    )
    useCanvasCollapseStore.setState({
      workspaces: {
        [harness.workspaceId]: {
          ...EMPTY_CANVAS_COLLAPSE,
          collapsedSpaceIds: { 'space-hidden': true },
        },
      },
    })
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()

    act(() => {
      assign(update(), {
        workspaceId: harness.workspaceId,
        createdNodeId: inside.id,
        createdNode: inside,
        targetSpaceId: 'space-a',
      })
    })

    expect(harness.readStoreDocument().nodes).toBe(nodesBefore)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })

  it('moves the created node out of every other Space', () => {
    const other = space({ id: 'space-b', name: 'Space B', nodeIds: ['wide'], rect: null })
    const { harness, update } = setup([seedNote, wide], [space(), other])

    act(() => {
      assign(update(), {
        workspaceId: harness.workspaceId,
        createdNodeId: wide.id,
        createdNode: wide,
        targetSpaceId: 'space-a',
      })
    })

    const [a, b] = harness.readStoreDocument().spaces
    expect(a.nodeIds).toEqual(['seed-note', 'wide'])
    expect(b.nodeIds).toEqual([])
  })

  it('lays out the created node that the caller passes when the store holds a different one', () => {
    // The store still holds the node where the creator placed it; the caller knows the real rect.
    const placed = node('wide', { x: 300, y: 300 }, { width: 100, height: 100 })
    const { harness, update } = setup([seedNote, placed, bystander], [space()])

    act(() => {
      assign(update(), {
        workspaceId: harness.workspaceId,
        createdNodeId: wide.id,
        createdNode: wide,
        targetSpaceId: 'space-a',
      })
    })

    const [stored] = harness.readStoreDocument().spaces
    expect(stored.rect!.x + stored.rect!.width).toBeGreaterThanOrEqual(1200)
  })
})

describe('assignNodeToSpaceAndExpand after a workspace switch', () => {
  it('pushes against the nodes of the workspace it started in and leaves the other alone', () => {
    const harness = createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      nodes: [seedNote, wide, bystander],
      spaces: [space()],
    })
    const otherBystander = node('other-bystander', { x: 1100, y: 250 }, { width: 200, height: 100 })
    const otherSpace = space({ id: 'space-b', nodeIds: [] })
    useAppStore.setState(state => ({
      workspaces: [
        ...state.workspaces,
        {
          ...state.workspaces[0],
          id: 'workspace-b',
          nodes: [otherBystander],
          spaces: [otherSpace],
        },
      ],
    }))
    let shown = 'workspace-a'
    const view = renderInCanvasDocument(
      () => {
        const nodes = useWorkspaceCanvasStoreNodes(shown)
        return useWorkspaceCanvasNodesStore({
          workspaceId: shown,
          workspacePath: `/tmp/${shown}`,
          nodes,
          onNodesCommitted: vi.fn(),
          isLiveGestureActive: () => false,
          standardWindowSizeBucket: 'regular',
          browserDefaultMode: 'iframe',
        })
      },
      { workspaceId: () => shown },
    )
    const updateOfA = view.result.current.updateCanvasDocument
    const documentOfB = readWorkspaceDocument('workspace-b')

    // The creation awaited, and the user switched to B before it resolved.
    act(() => {
      shown = 'workspace-b'
      view.rerender()
    })
    act(() => {
      assign(updateOfA, {
        workspaceId: 'workspace-a',
        createdNodeId: wide.id,
        createdNode: wide,
        targetSpaceId: 'space-a',
      })
    })

    const a = readWorkspaceDocument('workspace-a')!
    const rect = a.spaces[0].rect!
    expect(a.nodes.find(item => item.id === 'bystander')!.position.x).toBeGreaterThanOrEqual(
      rect.x + rect.width,
    )
    expect(readWorkspaceDocument('workspace-b')).toEqual(documentOfB)
    expect(harness.flush).not.toHaveBeenCalled()
  })
})

describe('assignNodeToSpaceAndExpand and the Space snapshot of the caller', () => {
  const baseline = space({ id: 'target', name: 'Feature', nodeIds: [], rect: null })
  const snapshot = space({
    id: 'target',
    name: 'Feature',
    directoryPath: '/workspace/.opencove/worktrees/feature-a',
    targetMountId: 'mount-1',
    nodeIds: [],
    rect: { x: 0, y: 0, width: 1200, height: 800 },
  })
  const created = node('created', { x: 100, y: 100 }, { width: 100, height: 100 })

  function run(
    stored: WorkspaceSpaceState[],
    input: Partial<Omit<Assign, 'updateCanvasDocument'>>,
  ) {
    const { harness, update } = setup([], stored)
    act(() => {
      assign(update(), {
        workspaceId: harness.workspaceId,
        createdNodeId: created.id,
        createdNode: created,
        targetSpaceId: 'target',
        ...input,
      })
    })
    return harness.readStoreDocument().spaces
  }

  it('adds a target that only the persisted snapshot holds, with the other snapshot Spaces', () => {
    const local = space({ id: 'local', nodeIds: ['local-node'], rect: null })
    const sibling = space({ id: 'sibling', nodeIds: ['sibling-node'], rect: null })

    const spaces = run([local], {
      targetSpaceSnapshot: snapshot,
      targetSpaceBaseline: null,
      workspaceSpacesSnapshot: [snapshot, sibling],
    })

    expect(spaces.map(item => item.id)).toEqual(['local', 'target', 'sibling'])
    expect(spaces[1]).toMatchObject({
      directoryPath: '/workspace/.opencove/worktrees/feature-a',
      targetMountId: 'mount-1',
      nodeIds: ['created'],
    })
    expect(spaces[2].nodeIds).toEqual(['sibling-node'])
  })

  it('adds the snapshot alone when no snapshot of the workspace holds the target', () => {
    const local = space({ id: 'local', nodeIds: ['local-node'], rect: null })

    const spaces = run([local], { targetSpaceSnapshot: snapshot, targetSpaceBaseline: null })

    expect(spaces.map(item => item.id)).toEqual(['local', 'target'])
    expect(spaces[1].nodeIds).toEqual(['created'])
  })

  it('takes the snapshot fields of a target that still equals its baseline', () => {
    const spaces = run([baseline], { targetSpaceSnapshot: snapshot, targetSpaceBaseline: baseline })

    expect(spaces).toEqual([
      expect.objectContaining({
        id: 'target',
        directoryPath: '/workspace/.opencove/worktrees/feature-a',
        targetMountId: 'mount-1',
        nodeIds: ['created'],
      }),
    ])
  })

  it('keeps the fields of a target that changed since its baseline', () => {
    const changedBoundary = {
      allowedMountIds: ['mount-local'],
      scopesByMountId: {},
      allowedPluginIds: null,
      capabilities: null,
      trustLevel: null,
    }
    const changed = {
      ...baseline,
      name: 'Renamed Locally',
      directoryPath: '/repo/manual-change',
      targetMountId: 'mount-local',
      parentSpaceId: 'parent-local',
      boundary: changedBoundary,
      sortOrder: 42,
    }

    const spaces = run([changed], { targetSpaceSnapshot: snapshot, targetSpaceBaseline: baseline })

    expect(spaces).toEqual([
      expect.objectContaining({
        id: 'target',
        name: 'Renamed Locally',
        directoryPath: '/repo/manual-change',
        targetMountId: 'mount-local',
        parentSpaceId: 'parent-local',
        boundary: changedBoundary,
        sortOrder: 42,
        nodeIds: ['created'],
      }),
    ])
  })

  it('reads the Spaces of the store when it writes, not the ones of an earlier read', () => {
    const { harness, update } = setup([], [baseline])
    const updater = update()

    act(() => {
      // A write that lands between the caller's decision and the push-away.
      replaceSpacesInStore(harness.workspaceId, [
        { ...baseline, name: 'Renamed Locally' },
        space({ id: 'late', nodeIds: [], rect: null }),
      ])
      assign(updater, {
        workspaceId: harness.workspaceId,
        createdNodeId: created.id,
        createdNode: created,
        targetSpaceId: 'target',
      })
    })

    expect(harness.readStoreDocument().spaces.map(item => item.id)).toEqual(['target', 'late'])
  })
})
