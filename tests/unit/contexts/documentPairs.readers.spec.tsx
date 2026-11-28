import { act } from '@testing-library/react'
import { getViewportForBounds, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useCanvasCollapse } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useCanvasCollapse'
import { useWorkspaceCanvasMenuActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasMenuActions'
import type { UpdateCanvasDocument } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.types'
import { useCanvasNodeWriter } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeWriter'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import { useWorkspaceCanvasSpaceUi } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceUi'
import { useCanvasCollapseStore } from '../../../src/contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'
import {
  createAgentSettingsReader,
  readDefaultAgentSettings,
} from '../../support/agentSettingsReader'

const readAgentSettings = createAgentSettingsReader({
  standardWindowSizeBucket: 'regular',
  focusNodeTargetZoom: 1,
})

// `t` is stable, as it is in the app: a callback that lists it must not be rebuilt on every render,
// or it could hide a writer or a reader that is missing from the same list.
const translation = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => translation }))

// The hooks that write a pair of nodes and Spaces, and the one that reads a Space, belong to the
// workspace of the render that made them (#702, PR 9): the writer they are given and the reader
// they create follow a switch of workspace. Each case acts in workspace A, shows B (the provider
// and the app store's active workspace move together, as in the app) and acts again.
//
// Everything a callback could depend on besides the writer and the reader is stable here: the
// canvas store's other values keep the value of the first render, so a writer or a reader that is
// frozen to the first render, or missing from a dependency list, cannot be hidden by another
// dependency that changes with the workspace.

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

const A = 'workspace-a'
const B = 'workspace-b'

const setViewport = vi.fn()
const reactFlow = {
  setViewport,
  fitView: vi.fn(),
  setCenter: vi.fn(),
} as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>

// The nodes carry the initial size that the node store would otherwise add with its first write.
function sized(nodes: Node<TerminalNodeData>[]): Node<TerminalNodeData>[] {
  return nodes.map(node => ({
    ...node,
    initialWidth: node.data.width,
    initialHeight: node.data.height,
  }))
}

const scattered = (ids: string[]) =>
  sized(
    createRowNodes(ids).map((node, index) => ({
      ...node,
      position: { x: index * 37, y: index * 11 },
    })),
  )

const positions = (workspaceId: string) =>
  readDocument(workspaceId).nodes.map(node => node.position)

function readDocument(workspaceId: string) {
  return useAppStore.getState().workspaces.find(workspace => workspace.id === workspaceId)!
}

/**
 * Seeds workspaces A and B, renders `useHook` under the provider of the shown workspace, and
 * returns the view and a function that shows B. `useHook` receives the shown workspace and the
 * node store's writer of that workspace, as the canvas hands it down.
 */
function renderInTwoWorkspaces<Result>(
  useHook: (input: { workspaceId: string; updateCanvasDocument: UpdateCanvasDocument }) => Result,
  documents: Record<
    'a' | 'b',
    { nodes?: Node<TerminalNodeData>[]; spaces?: WorkspaceSpaceState[] }
  >,
) {
  createCanvasDocumentHarness({ workspaceId: A, ...documents.a })
  useAppStore.setState(state => ({
    workspaces: [
      ...state.workspaces,
      { ...state.workspaces[0], id: B, nodes: [], spaces: [], ...documents.b },
    ],
  }))
  let shown = A
  const view = renderInCanvasDocument(
    () => {
      useWorkspaceCanvasNodesStore({
        workspaceId: shown,
        workspacePath: `/tmp/${shown}`,
        nodes: [],
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
        readAgentSettings: readDefaultAgentSettings,
      })
      const { updateCanvasDocument } = useCanvasNodeWriter()
      return useHook({ workspaceId: shown, updateCanvasDocument })
    },
    { workspaceId: () => shown },
  )
  return {
    view,
    showB: () =>
      act(() => {
        shown = B
        useAppStore.setState({ activeWorkspaceId: B })
        view.rerender()
      }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  firstRender.values.clear()
})

afterEach(() => {
  useCanvasCollapseStore.setState({ workspaces: {} })
  localStorage.removeItem('opencove:canvas-collapse:v1')
  vi.unstubAllGlobals()
})

describe('useCanvasCollapse in two workspaces', () => {
  const node = (id: string, x: number, y: number) => ({
    ...sized(createRowNodes([id]))[0],
    position: { x, y },
  })

  it('plans from the shown workspace and writes it, whichever workspace came first', () => {
    useCanvasCollapseStore.setState({
      workspaces: {
        [A]: { collapsedNodeIds: { target: true }, collapsedSpaceIds: {} },
        [B]: { collapsedNodeIds: { target: true }, collapsedSpaceIds: {} },
      },
    })
    const { view, showB } = renderInTwoWorkspaces(
      ({ workspaceId, updateCanvasDocument }) =>
        useCanvasCollapse({
          workspaceId,
          nodes: [],
          spaces: [],
          reactFlow: reactFlow as never,
          focusNodeTargetZoom: 1,
          nodeExpandBehavior: 'push-away',
          updateCanvasDocument,
        }),
      {
        a: { nodes: [node('target', 0, 0), node('peer', 100, 0)] },
        b: { nodes: [node('target', 1000, 1000), node('peer', 1100, 1000)] },
      },
    )
    act(() => {
      view.result.current.expandNode('target')
    })
    const writtenToA = positions(A)
    expect(writtenToA[1]).not.toEqual({ x: 100, y: 0 })
    expect(positions(B)).toEqual([
      { x: 1000, y: 1000 },
      { x: 1100, y: 1000 },
    ])

    showB()
    let returned: Node<TerminalNodeData> | undefined
    act(() => {
      returned = view.result.current.expandNode('target')
    })

    expect(positions(A)).toEqual(writtenToA)
    expect(positions(B)[1]).not.toEqual({ x: 1100, y: 1000 })
    expect(returned?.position).toEqual({ x: 1000, y: 1000 })
  })
})

describe('the menu actions in two workspaces', () => {
  const room = (origin: number, width: number) =>
    createSpace('room', { x: origin, y: origin, width, height: 1600 }, ['a', 'b', 'c'])
  const shifted = (nodes: Node<TerminalNodeData>[]) =>
    nodes.map(node => ({
      ...node,
      position: { x: node.position.x + 500, y: node.position.y + 500 },
    }))

  function renderMenuActions(documents: Parameters<typeof renderInTwoWorkspaces>[1]) {
    return renderInTwoWorkspaces(
      () =>
        useWorkspaceCanvasMenuActions({
          selectedNodeIds: [],
          flowNodes: [],
          reactFlow,
          readAgentSettings,
        }),
      documents,
    )
  }

  it('arranges the shown workspace', () => {
    const { view, showB } = renderMenuActions({
      a: { nodes: scattered(['a', 'b', 'c']) },
      b: { nodes: scattered(['a', 'b', 'c']) },
    })
    const scatteredPositions = positions(B)
    act(() => view.result.current.arrangeCanvas())
    const arrangedA = positions(A)
    expect(arrangedA).not.toEqual(scatteredPositions)
    expect(positions(B)).toEqual(scatteredPositions)

    showB()
    act(() => view.result.current.arrangeCanvas())

    expect(positions(A)).toEqual(arrangedA)
    expect(positions(B)).not.toEqual(scatteredPositions)
  })

  it('focuses the Space of the shown workspace after arranging it', async () => {
    const { view, showB } = renderMenuActions({
      a: { nodes: scattered(['a', 'b', 'c']), spaces: [room(-50, 2400)] },
      // Arranged where it stands, so the two Spaces end up in different places.
      b: { nodes: shifted(scattered(['a', 'b', 'c'])), spaces: [room(450, 2000)] },
    })
    const focusedRect = async (workspaceId: string) => {
      setViewport.mockClear()
      act(() => view.result.current.arrangeInSpace('room'))
      await act(async () => {
        await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
      })
      expect(setViewport).toHaveBeenCalledTimes(1)
      const stored = readDocument(workspaceId).spaces[0].rect!
      expect(vi.mocked(setViewport).mock.calls[0][0]).toEqual(
        getViewportForBounds(stored, 1440, 900, 0.5, 1, 0.16),
      )
    }

    await focusedRect(A)
    showB()
    await focusedRect(B)
  })

  it('converts the note of the shown workspace', () => {
    const [note] = sized(createRowNodes(['n']))
    const { view, showB } = renderMenuActions({
      a: { nodes: [note] },
      b: { nodes: [{ ...note, position: { x: 500, y: 500 } }] },
    })
    let converted = false
    act(() => {
      converted = view.result.current.convertNoteToTask('n')
    })
    expect(converted).toBe(true)
    expect(readDocument(A).nodes[0].data.kind).toBe('task')
    expect(readDocument(B).nodes[0].data.kind).toBe('note')

    showB()
    act(() => {
      converted = view.result.current.convertNoteToTask('n')
    })

    expect(converted).toBe(true)
    expect(readDocument(B).nodes[0].data.kind).toBe('task')
  })
})

describe('useSpaceUi in two workspaces', () => {
  const noop = () => undefined
  const space = (directoryPath: string) => ({ ...createSpace('space-1', null, []), directoryPath })

  function stubCopyPath() {
    const copyPath = vi.fn(async () => undefined)
    vi.stubGlobal('opencoveApi', { workspace: { copyPath } })
    return copyPath
  }

  it('copies the directory of a Space written to the store in the same call, in the shown workspace', async () => {
    const copyPath = stubCopyPath()
    const { view, showB } = renderInTwoWorkspaces(
      () =>
        useWorkspaceCanvasSpaceUi({
          workspacePath: '/workspace',
          handlePaneClick: noop,
          handlePaneContextMenu: noop,
          handleNodeContextMenu: noop,
          handleSelectionContextMenu: noop,
        }),
      { a: {}, b: {} },
    )

    await act(async () => {
      replaceSpacesInStore(A, [space('/dir-a')])
      await view.result.current.copySpacePath('space-1')
    })
    expect(copyPath).toHaveBeenLastCalledWith({ path: '/dir-a' })

    showB()
    await act(async () => {
      replaceSpacesInStore(B, [space('/dir-b')])
      await view.result.current.copySpacePath('space-1')
    })
    expect(copyPath).toHaveBeenLastCalledWith({ path: '/dir-b' })
  })

  it('falls back to the workspace path for a Space the store does not hold', async () => {
    const copyPath = stubCopyPath()
    const { view } = renderInTwoWorkspaces(
      () =>
        useWorkspaceCanvasSpaceUi({
          workspacePath: '/workspace',
          handlePaneClick: noop,
          handlePaneContextMenu: noop,
          handleNodeContextMenu: noop,
          handleSelectionContextMenu: noop,
        }),
      { a: {}, b: {} },
    )

    await act(async () => {
      await view.result.current.copySpacePath('missing')
    })

    expect(copyPath).toHaveBeenLastCalledWith({ path: '/workspace' })
  })
})
