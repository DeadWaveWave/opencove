import { act } from '@testing-library/react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  type NodeExpandBehavior,
} from '@contexts/settings/domain/agentSettings'
import { useCanvasCollapse } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useCanvasCollapse'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '@contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { useCanvasSelectionCommands } from '@contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { replaceWorkspaceNodes } from '@contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { useCanvasCollapseStore } from '@contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import {
  CANVAS_DOCUMENT_WORKSPACE_ID,
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasDocumentHarness,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'

// A collapse action plans from the committed document and writes the nodes and the Spaces in one
// store update (#702, PR 9). The nodes carry the initial size that the node store would otherwise
// add with its first write, so that a plan that changes nothing is a write of nothing.

const WORKSPACE = CANVAS_DOCUMENT_WORKSPACE_ID

// `prepare` sees the document the store holds when it runs.
const motion = vi.hoisted(() => ({
  prepare: vi.fn(),
  readStoreNodes: null as null | (() => unknown[]),
}))
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useCollapseLayoutMotion',
  () => ({ useCollapseLayoutMotion: () => ({ prepare: motion.prepare, getDelay: () => 0 }) }),
)

function createNode(id: string, x = 0, y = 0): Node<TerminalNodeData> {
  return {
    id,
    position: { x, y },
    initialWidth: 640,
    initialHeight: 480,
    data: {
      title: id,
      kind: 'terminal',
      sessionId: `${id}-session`,
      width: 640,
      height: 480,
      status: 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: 'ongoing output',
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    },
  }
}

function createSpace(overrides: Partial<WorkspaceSpaceState> = {}): WorkspaceSpaceState {
  return {
    id: 'space-1',
    name: 'Space 1',
    directoryPath: '/workspace',
    targetMountId: null,
    labelColor: null,
    nodeIds: ['target', 'peer'],
    rect: { x: -40, y: -40, width: 1700, height: 1200 },
    ...overrides,
  }
}

function seedCollapsed(nodeIds: string[], spaceIds: string[] = []) {
  useCanvasCollapseStore.setState({
    workspaces: {
      [WORKSPACE]: {
        collapsedNodeIds: Object.fromEntries(nodeIds.map(id => [id, true as const])),
        collapsedSpaceIds: Object.fromEntries(spaceIds.map(id => [id, true as const])),
      },
    },
  })
}

const setCenter = vi.fn()
const reactFlow = { setCenter } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
let behavior: NodeExpandBehavior = DEFAULT_AGENT_SETTINGS.nodeExpandBehavior

function useActions({ workspaceId, nodes, spaces, nodeStore }: CanvasNodeStoreContext) {
  return {
    selection: useCanvasSelectionCommands(),
    collapse: useCanvasCollapse({
      workspaceId,
      nodes,
      spaces,
      reactFlow,
      focusNodeTargetZoom: 0.85,
      nodeExpandBehavior: behavior,
      updateCanvasDocument: nodeStore.updateCanvasDocument,
    }),
  }
}

function renderActions({
  nodes = [createNode('target'), createNode('peer', 200)],
  spaces = [],
  collapsed = ['target'],
  collapsedSpaces = [],
  expandBehavior = DEFAULT_AGENT_SETTINGS.nodeExpandBehavior,
}: {
  nodes?: Node<TerminalNodeData>[]
  spaces?: WorkspaceSpaceState[]
  collapsed?: string[]
  collapsedSpaces?: string[]
  expandBehavior?: NodeExpandBehavior
} = {}) {
  behavior = expandBehavior
  const harness = createCanvasDocumentHarness({ nodes, spaces })
  motion.readStoreNodes = () => harness.readStoreDocument().nodes
  seedCollapsed(collapsed, collapsedSpaces)
  const view = renderCanvasNodeStore(harness, { extend: useActions })
  harness.notifications.mockClear()
  return {
    harness,
    view,
    originalNodes: nodes,
    collapse: () => view.result.current.collapse,
    stored: () => harness.readStoreDocument(),
    storedNode: (id: string) => harness.readStoreDocument().nodes.find(node => node.id === id)!,
  }
}

const layoutSyncs = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, layoutSyncs)
})

afterEach(() => {
  window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, layoutSyncs)
  useCanvasCollapseStore.setState({ workspaces: {} })
  localStorage.removeItem('opencove:canvas-collapse:v1')
})

// The store may hold the node as the canvas decorated it, so identity is that of its parts.
function expectUnmoved(stored: Node<TerminalNodeData>, original: Node<TerminalNodeData>) {
  expect(stored.position).toBe(original.position)
  expect(stored.data).toBe(original.data)
}

function expectNothingWritten(harness: CanvasDocumentHarness) {
  expect(harness.notifications).not.toHaveBeenCalled()
  expect(harness.flush).not.toHaveBeenCalled()
}

describe('collapsed window expansion actions', () => {
  it('uses the default resize layout in place, pushes its peer and retains runtime data', () => {
    const actions = renderActions()
    act(() => actions.collapse().toggleNode('target'))
    const [target, peer] = actions.stored().nodes
    expect(target.position).toEqual(actions.originalNodes[0].position)
    expect(peer.position).not.toEqual(actions.originalNodes[1].position)
    expect(
      peer.position.x >= target.position.x + target.data.width ||
        peer.position.y >= target.position.y + target.data.height,
    ).toBe(true)
    expect(target.data).toBe(actions.originalNodes[0].data)
    expect(peer.data).toBe(actions.originalNodes[1].data)
    expect(actions.originalNodes[1].position).toEqual({ x: 200, y: 0 })
    expect(actions.collapse().collapsedNodeIds.target).toBeUndefined()
    // The layout never asks the terminals to re-fit, and the nodes and the Spaces arrive together.
    expect(layoutSyncs).not.toHaveBeenCalled()
    expect(actions.harness.notifications).toHaveBeenCalledTimes(1)
    expect(actions.harness.flush).toHaveBeenCalledOnce()
    expect(setCenter).not.toHaveBeenCalled()
  })

  it('reveals into nearby free space and focuses the relocated target rather than its old position', () => {
    const actions = renderActions({ expandBehavior: 'find-space' })
    act(() => actions.collapse().revealNode('target'))
    const [target, peer] = actions.stored().nodes
    expect(target.position).not.toEqual(actions.originalNodes[0].position)
    expectUnmoved(peer, actions.originalNodes[1])
    expect(target.data).toBe(actions.originalNodes[0].data)
    expect(setCenter).toHaveBeenCalledWith(
      target.position.x + target.data.width / 2,
      target.position.y + target.data.height / 2,
      expect.objectContaining({ zoom: 0.85 }),
    )
    expect(actions.collapse().collapsedNodeIds.target).toBeUndefined()
  })

  it('ignores actions for a node that was deleted after the collapsed view was saved', () => {
    const actions = renderActions({ nodes: [createNode('peer', 200)] })
    const before = useCanvasCollapseStore.getState().workspaces[WORKSPACE]
    act(() => {
      actions.collapse().toggleNode('target')
      actions.collapse().revealNode('target')
      expect(actions.collapse().expandNode('target')).toBeUndefined()
    })
    expectNothingWritten(actions.harness)
    expect(setCenter).not.toHaveBeenCalled()
    expect(motion.prepare).not.toHaveBeenCalled()
    expect(useCanvasCollapseStore.getState().workspaces[WORKSPACE]).toBe(before)
  })

  it('does not re-layout or flush an already expanded window when revealed again', () => {
    const actions = renderActions({ expandBehavior: 'find-space' })
    act(() => actions.collapse().revealNode('target'))
    const expandedNodes = actions.stored().nodes
    actions.harness.notifications.mockClear()
    actions.harness.flush.mockClear()
    act(() => actions.collapse().revealNode('target'))
    expect(actions.stored().nodes).toBe(expandedNodes)
    expectNothingWritten(actions.harness)
    expect(setCenter).toHaveBeenCalledTimes(2)
  })

  it('honors a settings change before the next toggle and focuses the relocated window', () => {
    const actions = renderActions()
    behavior = 'find-space'
    actions.view.rerender()
    act(() => actions.collapse().toggleNode('target'))
    const [target, peer] = actions.stored().nodes
    expect(target.position).not.toEqual(actions.originalNodes[0].position)
    expectUnmoved(peer, actions.originalNodes[1])
    expect(setCenter).toHaveBeenCalledWith(
      target.position.x + target.data.width / 2,
      target.position.y + target.data.height / 2,
      expect.objectContaining({ zoom: 0.85 }),
    )
  })

  it('writes the layout once and flushes only because the disclosure changed', () => {
    const actions = renderActions()
    act(() => {
      expect(actions.collapse().expandNode('target')).toBeDefined()
    })
    expect(actions.harness.notifications).toHaveBeenCalledTimes(1)
    expect(actions.harness.flush).toHaveBeenCalledTimes(1)
  })

  it('returns the node of the layout it wrote', () => {
    const actions = renderActions({ expandBehavior: 'find-space' })
    let returned: Node<TerminalNodeData> | undefined
    act(() => {
      returned = actions.collapse().expandNode('target')
    })
    expect(returned?.position).toEqual(actions.storedNode('target').position)
  })

  it('expands a node that another writer added to the store in the same call', () => {
    const actions = renderActions({ collapsed: ['target', 'late'] })
    let returned: Node<TerminalNodeData> | undefined
    act(() => {
      replaceWorkspaceNodes(actions.harness.workspaceId, [
        ...actions.stored().nodes,
        createNode('late', 0, 600),
      ])
      returned = actions.collapse().expandNode('late')
    })
    expect(returned?.id).toBe('late')
    expect(useCanvasCollapseStore.getState().workspaces[WORKSPACE].collapsedNodeIds.late).toBe(
      undefined,
    )
    // The replace, and then the expansion.
    expect(actions.harness.notifications).toHaveBeenCalledTimes(2)
  })

  it('keeps the canvas selection flag of the nodes it moves', () => {
    const actions = renderActions()
    act(() => actions.view.result.current.selection.setNodeIds(['peer']))
    expect(actions.storedNode('peer').selected).toBeFalsy()
    expect(actions.view.result.current.nodeStore.nodesRef.current[1].selected).toBe(true)
    act(() => actions.collapse().expandNode('target'))
    const peer = actions.storedNode('peer')
    expect(peer.position).not.toEqual({ x: 200, y: 0 })
    expect(peer.selected).toBe(true)
  })

  it('prepares the motion before the write, with the planned layout', () => {
    const actions = renderActions()
    const before = actions.stored().nodes
    let seenBeforeWrite: unknown[] | null = null
    motion.prepare.mockImplementation(() => {
      seenBeforeWrite = motion.readStoreNodes?.() ?? null
    })
    act(() => actions.collapse().expandNode('target'))
    expect(motion.prepare).toHaveBeenCalledTimes(1)
    expect(seenBeforeWrite).toBe(before)
    const [kind, plannedNodes] = motion.prepare.mock.calls[0] as [string, Node<TerminalNodeData>[]]
    expect(kind).toBe('expand')
    expect(plannedNodes.map(node => node.position)).toEqual(
      actions.stored().nodes.map(node => node.position),
    )
  })

  describe('that change only the disclosure', () => {
    it('toggling an expanded window collapses it: one flush, no write', () => {
      const actions = renderActions({ collapsed: [] })
      act(() => actions.collapse().toggleNode('target'))
      expect(actions.harness.notifications).not.toHaveBeenCalled()
      expect(actions.harness.flush).toHaveBeenCalledTimes(1)
      expect(useCanvasCollapseStore.getState().workspaces[WORKSPACE].collapsedNodeIds.target).toBe(
        true,
      )
      expect(layoutSyncs).not.toHaveBeenCalled()
    })

    // A write of an unchanged layout would still add the initial sizes the nodes lack, so only the
    // decision before the write keeps this one from writing.
    it('revealing an expanded window writes nothing, whether or not its node has initial sizes', () => {
      const unsized = [createNode('target'), createNode('peer', 200)].map(
        ({ initialWidth: _w, initialHeight: _h, ...node }) => node,
      )
      const actions = renderActions({ nodes: unsized, collapsed: [] })
      act(() => actions.collapse().revealNode('target'))
      expectNothingWritten(actions.harness)
    })

    it('revealing an expanded window writes nothing and flushes nothing', () => {
      const actions = renderActions({ collapsed: [] })
      act(() => actions.collapse().revealNode('target'))
      expectNothingWritten(actions.harness)
      expect(motion.prepare).not.toHaveBeenCalled()
      expect(setCenter).toHaveBeenCalledTimes(1)
    })

    // A collapsed Space is a legacy form that the hook migrates away after a render, so the
    // store is written in the same call as the reveal.
    it('revealing a window of a collapsed Space opens the Space with one flush and no write', () => {
      const actions = renderActions({ spaces: [createSpace()], collapsed: [] })
      act(() => {
        seedCollapsed([], ['space-1'])
        actions.collapse().revealNode('target')
      })
      expect(actions.harness.notifications).not.toHaveBeenCalled()
      expect(actions.harness.flush).toHaveBeenCalledTimes(1)
      expect(useCanvasCollapseStore.getState().workspaces[WORKSPACE]).toEqual({
        collapsedNodeIds: {},
        collapsedSpaceIds: {},
      })
    })
  })
})

describe('collapse and arrange, and its undo', () => {
  // Cards are arranged in the Space's own corner, so windows that sit elsewhere in it move.
  function arrangedSpace() {
    return renderActions({
      nodes: [createNode('target', 300, 300), createNode('peer', 900, 500)],
      spaces: [createSpace()],
      collapsed: [],
    })
  }

  it('writes the nodes and the Spaces in one store update, flushes once and syncs no layout', () => {
    const actions = arrangedSpace()
    act(() => actions.collapse().collapseAndArrange('space-1'))
    expect(actions.storedNode('target').position).not.toEqual({ x: 300, y: 300 })
    expect(actions.harness.notifications).toHaveBeenCalledTimes(1)
    expect(actions.harness.flush).toHaveBeenCalledTimes(1)
    expect(layoutSyncs).not.toHaveBeenCalled()
    expect(
      Object.keys(useCanvasCollapseStore.getState().workspaces[WORKSPACE].collapsedNodeIds).sort(),
    ).toEqual(['peer', 'target'])
  })

  it('undoes in one store update and brings the geometry and the disclosure back', () => {
    const actions = arrangedSpace()
    const original = actions.stored()
    act(() => actions.collapse().collapseAndArrange('space-1'))
    actions.harness.notifications.mockClear()
    actions.harness.flush.mockClear()

    act(() => actions.collapse().undoArrange('space-1'))

    const restored = actions.stored()
    expect(restored.nodes.map(node => node.position)).toEqual(
      original.nodes.map(node => node.position),
    )
    expect(restored.spaces.map(space => space.rect)).toEqual(
      original.spaces.map(space => space.rect),
    )
    expect(useCanvasCollapseStore.getState().workspaces[WORKSPACE].collapsedNodeIds).toEqual({})
    expect(actions.harness.notifications).toHaveBeenCalledTimes(1)
    expect(actions.harness.flush).toHaveBeenCalledTimes(1)
    expect(layoutSyncs).not.toHaveBeenCalled()
    expect(actions.collapse().canUndoArrange('space-1')).toBe(false)
  })

  it('keeps the canvas selection flag through the arrange and the undo', () => {
    const actions = arrangedSpace()
    act(() => actions.view.result.current.selection.setNodeIds(['target']))
    expect(actions.view.result.current.nodeStore.nodesRef.current[0].selected).toBe(true)
    act(() => actions.collapse().collapseAndArrange('space-1'))
    expect(actions.storedNode('target').selected).toBe(true)

    // The canvas selects the other window; the store still flags the first.
    act(() => actions.view.result.current.selection.setNodeIds(['peer']))
    expect(actions.view.result.current.nodeStore.nodesRef.current[1].selected).toBe(true)
    act(() => actions.collapse().undoArrange('space-1'))

    expect(actions.storedNode('target').selected).toBeFalsy()
    expect(actions.storedNode('peer').selected).toBe(true)
  })

  it('prepares the motion before each write, with the planned layout', () => {
    const actions = arrangedSpace()
    const calls: Array<{ kind: string; seen: unknown[] | null }> = []
    motion.prepare.mockImplementation((kind: string) => {
      calls.push({ kind, seen: motion.readStoreNodes?.() ?? null })
    })

    const beforeArrange = actions.stored().nodes
    act(() => actions.collapse().collapseAndArrange('space-1'))
    const arranged = actions.stored().nodes
    act(() => actions.collapse().undoArrange('space-1'))

    expect(calls.map(call => call.kind)).toEqual(['arrange', 'restore'])
    expect(calls[0].seen).toBe(beforeArrange)
    expect(calls[1].seen).toBe(arranged)
    const [, plannedArrange] = motion.prepare.mock.calls[0] as [string, Node<TerminalNodeData>[]]
    expect(plannedArrange.map(node => node.position)).toEqual(arranged.map(node => node.position))
    const [, plannedRestore] = motion.prepare.mock.calls[1] as [string, Node<TerminalNodeData>[]]
    expect(plannedRestore.map(node => node.position)).toEqual(
      actions.stored().nodes.map(node => node.position),
    )
  })

  it('does nothing for a Space without a rect: no write, no flush, no undo entry', () => {
    const actions = renderActions({
      nodes: [createNode('target', 300, 300)],
      spaces: [createSpace({ rect: null, nodeIds: ['target'] })],
      collapsed: [],
    })
    const before = useCanvasCollapseStore.getState().workspaces[WORKSPACE]
    act(() => actions.collapse().collapseAndArrange('space-1'))
    expectNothingWritten(actions.harness)
    expect(motion.prepare).not.toHaveBeenCalled()
    expect(useCanvasCollapseStore.getState().workspaces[WORKSPACE]).toBe(before)
    expect(actions.collapse().canUndoArrange('space-1')).toBe(false)
    act(() => actions.collapse().undoArrange('space-1'))
    expectNothingWritten(actions.harness)
  })

  it('does nothing when there is nothing to undo', () => {
    const actions = arrangedSpace()
    const before = useCanvasCollapseStore.getState().workspaces[WORKSPACE]
    act(() => actions.collapse().undoArrange('space-1'))
    expectNothingWritten(actions.harness)
    expect(motion.prepare).not.toHaveBeenCalled()
    expect(useCanvasCollapseStore.getState().workspaces[WORKSPACE]).toBe(before)
  })

  // A newer layout than the snapshot's makes the undo a no-op that still flushes.
  it('writes nothing but flushes once when the layout changed since the snapshot', () => {
    const actions = arrangedSpace()
    act(() => actions.collapse().collapseAndArrange('space-1'))
    act(() => {
      replaceWorkspaceNodes(
        actions.harness.workspaceId,
        actions.stored().nodes.map(node => ({ ...node, position: { x: 5000, y: 5000 } })),
      )
    })
    actions.harness.notifications.mockClear()
    actions.harness.flush.mockClear()

    act(() => actions.collapse().undoArrange('space-1'))

    expect(actions.harness.notifications).not.toHaveBeenCalled()
    expect(actions.harness.flush).toHaveBeenCalledTimes(1)
    expect(actions.storedNode('target').position).toEqual({ x: 5000, y: 5000 })
  })
})
