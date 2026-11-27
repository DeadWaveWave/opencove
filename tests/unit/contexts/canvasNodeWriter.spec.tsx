import { act } from '@testing-library/react'
import { useStoreApi, type Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useCanvasNodeWriter } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeWriter'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import {
  useCanvasInteractionCommands,
  useCanvasSelectionCommands,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import {
  agentNode,
  documentOf,
  nodeOf,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
} from '../../support/agentRuntimeHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'
import { sizedNode } from '../../support/nodeDragHarness'

// The canvas's node writer (#738, PR 4): what it writes, from what, and for which workspace. It
// is called here from a hook below the providers, with nothing of `WorkspaceCanvasInner`.

const ROW = () => createRowNodes(['a', 'b', 'c']).map(sizedNode)

const retitle = (id: string, title: string) => (nodes: Node<TerminalNodeData>[]) =>
  nodes.map(node => (node.id === id ? { ...node, data: { ...node.data, title } } : node))

const titleIn = (workspaceId: string, id: string) => nodeOf(workspaceId, id).data.title

function useWriterWithStore() {
  return {
    writer: useCanvasNodeWriter(),
    selection: useCanvasSelectionCommands(),
    interaction: useCanvasInteractionCommands(),
    reactFlow: useStoreApi(),
  }
}

/** Workspaces A and B in the app store; the provider shows `shown()`, the store's active one is set apart. */
function renderWriter({
  shown = () => A,
  active = A,
  extraNodes = [],
}: { shown?: () => string; active?: string; extraNodes?: Node<TerminalNodeData>[] } = {}) {
  const harness = createCanvasDocumentHarness({ workspaceId: A, nodes: [...ROW(), ...extraNodes] })
  useAppStore.setState(state => ({
    workspaces: [...state.workspaces, { ...state.workspaces[0], id: B, nodes: ROW(), spaces: [] }],
    activeWorkspaceId: active,
  }))
  const view = renderInCanvasDocument(() => useWriterWithStore(), { workspaceId: shown })
  return { harness, view }
}

afterEach(() => {
  vi.restoreAllMocks()
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
})

describe('the node writer, below the providers', () => {
  it('writes the workspace of its provider and leaves the others alone', () => {
    const { view } = renderWriter()
    const nodesOfB = documentOf(B).nodes

    act(() => view.result.current.writer.updateNodes(retitle('b', 'renamed')))

    expect(titleIn(A, 'b')).toBe('renamed')
    expect(documentOf(B).nodes).toBe(nodesOfB)
  })

  // The workspace is the provider's, not the app store's active one: Inner is not keyed by
  // workspace, and the provider follows the render.
  it('writes the workspace of its provider while the store shows another', () => {
    const { view } = renderWriter({ active: B })
    const nodesOfB = documentOf(B).nodes

    act(() => view.result.current.writer.updateNodes(retitle('b', 'renamed')))

    expect(titleIn(A, 'b')).toBe('renamed')
    expect(documentOf(B).nodes).toBe(nodesOfB)
  })

  it('writes the workspace it was made for when it is called after a switch', () => {
    let shown = A
    const { view } = renderWriter({ shown: () => shown })
    const writerOfA = view.result.current.writer
    const nodesOfB = documentOf(B).nodes

    act(() => {
      shown = B
      useAppStore.setState({ activeWorkspaceId: B })
      view.rerender()
    })
    expect(view.result.current.writer.updateNodes).not.toBe(writerOfA.updateNodes)
    act(() => writerOfA.updateNodes(retitle('b', 'late')))

    expect(titleIn(A, 'b')).toBe('late')
    expect(documentOf(B).nodes).toBe(nodesOfB)
    act(() =>
      view.result.current.writer.updateCanvasDocument(({ nodes, spaces }) => ({
        nodes: retitle('b', 'in B')(nodes),
        spaces,
      })),
    )
    expect(titleIn(B, 'b')).toBe('in B')
    expect(titleIn(A, 'b')).toBe('late')
  })
})

describe('the base of a recipe', () => {
  // S7, PR 3: the base is the committed nodes, the store's own objects. The selection is the
  // slice's and reaches React Flow through `decorateFlowNodes`; a recipe never sees it.
  it('is the committed nodes as they are when the recipe runs, with no selection in them', () => {
    const { view } = renderWriter()
    const stored = documentOf(A).nodes
    let seen: Node<TerminalNodeData>[] = []

    act(() => {
      view.result.current.selection.setNodeIds(['b'])
      view.result.current.writer.updateNodes(nodes => {
        seen = nodes
        return nodes
      })
    })

    expect(seen).toBe(stored)
    expect(seen.map(node => node.selected)).toEqual([undefined, undefined, undefined])
  })

  it('is computed from the store, so a store write made since the last render is part of it', () => {
    const { harness, view } = renderWriter()
    const seen: string[] = []

    act(() => {
      useAppStore.setState(state => ({
        workspaces: state.workspaces.map(workspace =>
          workspace.id === A
            ? { ...workspace, nodes: retitle('c', 'from elsewhere')(workspace.nodes) }
            : workspace,
        ),
      }))
      view.result.current.writer.updateNodes(nodes => {
        seen.push(...nodes.map(node => node.data.title))
        return retitle('a', 'renamed')(nodes)
      })
    })

    expect(seen).toContain('from elsewhere')
    expect(titleIn(A, 'c')).toBe('from elsewhere')
    expect(harness.readStoreDocument().nodes.find(node => node.id === 'a')?.data.title).toBe(
      'renamed',
    )
  })

  it('never carries the live positions of a gesture', () => {
    const { view } = renderWriter()
    const live = new Map([['a', { position: { x: 0, y: 30 }, dragging: true }]])
    act(() => view.result.current.interaction.publishLiveNodes(live))
    const seen: Array<number | undefined> = []

    act(() => {
      view.result.current.writer.updateNodes(nodes => {
        seen.push(nodes.find(node => node.id === 'a')?.position.y)
        return retitle('b', 'renamed')(nodes)
      })
    })

    expect(seen).toEqual([0])
    expect(nodeOf(A, 'a').position.y).toBe(0)
  })

  // A recipe that returns what it was given changes nothing, whatever the selection says, and one
  // that changes a node writes the rest of the base as it was.
  it('writes nothing for a recipe that returns its input', () => {
    const { harness, view } = renderWriter()
    act(() => view.result.current.selection.setNodeIds(['a', 'b']))
    const nodesBefore = documentOf(A).nodes
    harness.notifications.mockClear()

    act(() => view.result.current.writer.updateNodes(nodes => nodes))
    act(() => view.result.current.writer.updateCanvasDocument(document => document))

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(documentOf(A).nodes).toBe(nodesBefore)

    act(() => view.result.current.writer.updateNodes(retitle('c', 'changed')))

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(titleIn(A, 'c')).toBe('changed')
  })

  // A flush persists the write it accompanies (S7): a recipe that returns its input requests none.
  it('requests the persistence flush on a write that applied, once, and none for no change', () => {
    const { harness, view } = renderWriter()

    act(() => view.result.current.writer.updateNodes(nodes => nodes, { flush: true }))
    act(() =>
      view.result.current.writer.updateCanvasDocument(document => document, { flush: true }),
    )
    expect(harness.flush).not.toHaveBeenCalled()

    act(() => view.result.current.writer.updateNodes(retitle('c', 'flushed'), { flush: true }))
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })
})

describe('the node writer: what it writes besides the recipe', () => {
  // `ensureNodesHaveInitialDimensions` runs for every workspace, as before PR 4.
  it('gives initial dimensions to the nodes it writes to a workspace that is not shown', () => {
    const { view } = renderWriter({ active: B })
    const unsized = { ...createRowNodes(['n'])[0], position: { x: 0, y: 900 } }

    act(() => view.result.current.writer.updateNodes(nodes => [...nodes, unsized]))

    expect(nodeOf(A, 'n').initialWidth).toBe(unsized.data.width)
    expect(nodeOf(A, 'n').initialHeight).toBe(unsized.data.height)
  })

  // `dragHandle` follows React Flow's drag-surface mode in the view (`flowNodes`); the committed
  // nodes a recipe receives have none.
  it('hands a recipe no drag handle, also in the drag-surface mode', () => {
    const { view } = renderWriter()
    const seen: Array<string | undefined> = []
    act(() => {
      view.result.current.selection.setNodeIds(['b'])
      view.result.current.reactFlow.setState({ coveDragSurfaceSelectionMode: true } as never)
    })

    act(() =>
      view.result.current.writer.updateNodes(nodes => {
        seen.push(...nodes.map(node => node.dragHandle))
        return nodes
      }),
    )

    expect(seen).toEqual([undefined, undefined, undefined])
  })
})

describe('what follows a write: the layout-sync event and the test state', () => {
  function countLayoutEvents(): { count: () => number; stop: () => void } {
    const listener = vi.fn()
    window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, listener)
    return {
      count: () => listener.mock.calls.length,
      stop: () => window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, listener),
    }
  }

  it('fires the layout-sync event once for a write to the workspace that is shown', () => {
    const { view } = renderWriter()
    const events = countLayoutEvents()

    act(() => view.result.current.writer.updateNodes(retitle('b', 'renamed')))
    events.stop()

    expect(events.count()).toBe(1)
  })

  it('fires nothing when the write changes nothing, or when it asks for no layout sync', () => {
    const { view } = renderWriter()
    const events = countLayoutEvents()

    act(() => view.result.current.writer.updateNodes(nodes => nodes))
    act(() =>
      view.result.current.writer.updateNodes(retitle('b', 'renamed'), { syncLayout: false }),
    )
    events.stop()

    expect(events.count()).toBe(0)
  })

  it('fires nothing for a write to a workspace that is not shown any more', () => {
    let shown = A
    const { view } = renderWriter({ shown: () => shown })
    const writerOfA = view.result.current.writer
    act(() => {
      shown = B
      useAppStore.setState({ activeWorkspaceId: B })
      view.rerender()
    })
    const events = countLayoutEvents()

    act(() => writerOfA.updateNodes(retitle('b', 'late')))
    events.stop()

    expect(titleIn(A, 'b')).toBe('late')
    expect(events.count()).toBe(0)
  })

  // The test state lists the agent sessions of the written nodes; it follows the writes of the
  // workspace that is shown and ignores a late write of the one that is not.
  it('syncs the test state with the written nodes only for the shown workspace', () => {
    let shown = A
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: { meta: { isTest: true } },
    })
    const { view } = renderWriter({ shown: () => shown, extraNodes: [agentNode('agent-1')] })
    const writerOfA = view.result.current.writer
    const statusOfAgent = () =>
      window.__opencoveWorkspaceCanvasTestApi?.getAgentStatusByPtySessionId('agent-1-runtime')
    const setStatus = (status: 'running' | 'failed') => (nodes: Node<TerminalNodeData>[]) =>
      nodes.map(node =>
        node.id === 'agent-1' ? { ...node, data: { ...node.data, status } } : node,
      )

    act(() => writerOfA.updateNodes(setStatus('running')))
    expect(statusOfAgent()).toBe('running')

    act(() => {
      shown = B
      useAppStore.setState({ activeWorkspaceId: B })
      view.rerender()
    })
    act(() => writerOfA.updateNodes(setStatus('failed')))

    expect(nodeOf(A, 'agent-1').data.status).toBe('failed')
    expect(statusOfAgent()).toBe('running')
    Reflect.deleteProperty(window, 'opencoveApi')
  })
})
