import { act, render } from '@testing-library/react'
import { ReactFlowProvider, type Node } from '@xyflow/react'
import React, { type ReactElement } from 'react'
import { expect, type Mock } from 'vitest'
import { useAppStore } from '../../src/app/renderer/shell/store/useAppStore'
import {
  useCanvasNodeWriter,
  type CanvasNodeWriter,
} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeWriter'
import { useWorkspaceCanvasNodesStore } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import { readWorkspaceDocument } from '../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { WorkspaceDocument } from '../../src/contexts/workspace/presentation/renderer/store/workspaceDocument'
import { useCanvasUiCommands } from '../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../src/contexts/workspace/presentation/renderer/types'
import { createCanvasDocumentHarness, renderInCanvasDocument } from './canvasDocumentHarness'
import { CanvasStoreTestProvider } from './canvasStoreTestHarness'
import { useWorkspaceCanvasStoreNodes } from './workspaceCanvasStoreHarness'
import { setDocumentNodes } from './documentNodes'
import { readDefaultAgentSettings } from './agentSettingsReader'

// Shared by the specs that check what the callers of the push-away hand it (#702, PR 6). The spec
// that uses it mocks the push-away and the canvas store's stable hooks itself: module mocks do not
// cross files.

export const OLD_CHANNELS = ['spacesRef', 'nodesRef', 'setNodes', 'onSpacesChange']

export const TARGET: WorkspaceSpaceState = {
  id: 'target',
  name: 'Target',
  directoryPath: '/repo',
  targetMountId: null,
  labelColor: null,
  nodeIds: [],
  rect: { x: 0, y: 0, width: 4000, height: 4000 },
}

export const CREATED = {
  id: 'created',
  position: { x: 0, y: 0 },
  data: { width: 100, height: 100 },
} as unknown as Node<TerminalNodeData>

/** The workspace whose canvas the harness shows: where a creator of the specs writes its node. */
let shownWorkspaceId = 'workspace-a'

/**
 * A creator that behaves as the node store's do: it adds the node to the document of the
 * workspace shown, then returns it. A mock creator that only returned the node would let a caller
 * assign a node that the document does not hold, and no spec would see it (#758).
 */
export function createdInShownDocument(node: Node<TerminalNodeData> = CREATED) {
  return writeCreatedNode(shownWorkspaceId, node)
}

export function writeCreatedNode(workspaceId: string, node: Node<TerminalNodeData>) {
  const document = readWorkspaceDocument(workspaceId)
  if (!document) {
    throw new Error(`workspace ${workspaceId} is not in the store`)
  }
  setDocumentNodes(workspaceId, [...document.nodes.filter(item => item.id !== node.id), node])
  return node
}

/**
 * What the document held for the node of an assignment at the moment the assignment was called
 * (#758: the recipe takes the node from the document, so a caller must have written it first).
 */
export interface AssignmentRecord {
  createdNodeId: string
  /** The node as the document held it then, or `undefined` when it held none. */
  nodeInDocument: Node<TerminalNodeData> | undefined
}

export const assignmentRecords: AssignmentRecord[] = []

/**
 * Makes the mocked push-away record, for each call, the node the document holds under the id it was
 * given, read when it is called. `readDocument` defaults to the document of the workspace shown.
 */
export function recordAssignmentsAgainst(
  assign: Mock,
  readDocument: () => WorkspaceDocument | undefined = () => readWorkspaceDocument(shownWorkspaceId),
) {
  assignmentRecords.length = 0
  assign.mockImplementation((args: { createdNodeId: string }) => {
    assignmentRecords.push({
      createdNodeId: args.createdNodeId,
      nodeInDocument: readDocument()?.nodes.find(node => node.id === args.createdNodeId),
    })
  })
}

/**
 * The precondition of #758 for every assignment recorded so far: the document held the node when
 * the caller called the push-away. `assign` must have had its calls recorded, so that a spec
 * that forgot `recordAssignmentsAgainst` fails here, not silently.
 */
export function expectsEveryAssignedNodeInTheDocument(assign: Mock) {
  expect(assignmentRecords).toHaveLength(assign.mock.calls.length)
  for (const record of assignmentRecords) {
    expect(
      record.nodeInDocument,
      `the document held no node ${record.createdNodeId} when it was assigned to a Space`,
    ).toBeDefined()
  }
}

export const spacesRef = { current: [TARGET] }
export const nodesRef = { current: [] as Node<TerminalNodeData>[] }

export function lastCall(mock: unknown): unknown[] {
  const calls = (mock as Mock).mock.calls
  return calls[calls.length - 1] ?? []
}

export type Updater = CanvasNodeWriter['updateCanvasDocument']

export function useShownNodeStore(shown: string) {
  const nodes = useWorkspaceCanvasStoreNodes(shown)
  const writer = useCanvasNodeWriter()
  const store = useWorkspaceCanvasNodesStore({
    workspaceId: shown,
    workspacePath: `/tmp/${shown}`,
    nodes,
    standardWindowSizeBucket: 'regular',
    browserDefaultMode: 'iframe',
    readAgentSettings: readDefaultAgentSettings,
  })
  // The node store returns no writer; the canvas's comes from context.
  return { ...store, updateCanvasDocument: writer.updateCanvasDocument }
}

/**
 * `renderHook` under the canvas store provider of the workspace shown. `useHook` gets the document
 * writer of the node store of that render, as the canvas hands it to its hooks; `switchTo` shows
 * another workspace and renders again.
 */
export function renderCaller<Result>(useHook: (updateCanvasDocument: Updater) => Result) {
  let shown = 'workspace-a'
  shownWorkspaceId = shown
  const view = renderInCanvasDocument(
    () => {
      const store = useShownNodeStore(shown)
      return { ui: useCanvasUiCommands(), hook: useHook(store.updateCanvasDocument) }
    },
    { workspaceId: () => shown },
  )
  return {
    view,
    switchTo(workspaceId: string) {
      act(() => {
        shown = workspaceId
        shownWorkspaceId = shown
        view.rerender()
      })
    },
  }
}

type NodeStore = ReturnType<typeof useShownNodeStore>

/**
 * Like `renderCaller`, for a component under test: `element` builds it from the writer of the node
 * store of the shown workspace, and calls `capture` with what the test then invokes.
 */
function renderElementCaller<Result>(
  element: (
    updateCanvasDocument: Updater,
    store: NodeStore,
    capture: (value: Result) => void,
  ) => ReactElement,
) {
  let shown = 'workspace-a'
  shownWorkspaceId = shown
  const result = {
    current: undefined as unknown as { hook: Result; ui: ReturnType<typeof useCanvasUiCommands> },
  }
  function Harness(): ReactElement {
    const store = useShownNodeStore(shown)
    const ui = useCanvasUiCommands()
    return element(store.updateCanvasDocument, store, hook => {
      result.current = { hook, ui }
    })
  }
  function Wrapper({ children }: { children: React.ReactNode }): ReactElement {
    return (
      <CanvasStoreTestProvider workspaceId={shown}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </CanvasStoreTestProvider>
    )
  }
  const view = render(<Harness />, { wrapper: Wrapper })
  return {
    view: { result },
    switchTo(workspaceId: string) {
      act(() => {
        shown = workspaceId
        shownWorkspaceId = shown
        view.rerender(<Harness />)
      })
    },
  }
}

export function mark(id: string): WorkspaceSpaceState {
  return { ...TARGET, id, name: id, rect: null }
}

export type Invoke<Result> = (current: {
  hook: Result
  ui: ReturnType<typeof useCanvasUiCommands>
}) => unknown | Promise<unknown>

export function expectsOneFlushAfterThePushAway(
  flush: Mock | undefined,
  invocations: number,
  assign: Mock,
) {
  if (!flush) {
    return
  }
  expect(flush).toHaveBeenCalledTimes(invocations)
  const lastAssign = Math.max(...assign.mock.invocationCallOrder)
  expect(Math.max(...flush.mock.invocationCallOrder)).toBeGreaterThan(lastAssign)
}

/**
 * Calls `invoke` for workspace A, then for B after a switch. `argsOf` reads the arguments of the
 * mocked callee's last call. The writer in them must hold no old channel, and a marker Space
 * written through it must land in the workspace of the render that made the callback.
 */
export async function expectsWriterOfTheRender<Result>({
  useHook,
  element,
  seed = { spaces: [TARGET] },
  invoke,
  argsOf,
  absent = OLD_CHANNELS,
  flush,
  assign,
}: {
  useHook?: (updateCanvasDocument: Updater) => Result
  /** A component under test instead of a hook. */
  element?: Parameters<typeof renderElementCaller<Result>>[0]
  /** The nodes and Spaces both workspaces start with: the target Space unless told otherwise. */
  seed?: Parameters<typeof createCanvasDocumentHarness>[0]
  invoke: Invoke<Result>
  argsOf: () => Record<string, unknown> | undefined
  absent?: string[]
  /**
   * The caller flushes once after the push-away, as it did before: a spy it was given, or
   * `'document'` for the flush the shell registered with the document module.
   */
  flush?: Mock | 'document'
  /** The mocked push-away, to order the flush after it. */
  assign: Mock
}) {
  const harness = createCanvasDocumentHarness({ ...seed, workspaceId: 'workspace-a' })
  const flushSpy = flush === 'document' ? harness.flush : flush
  useAppStore.setState(state => ({
    workspaces: [...state.workspaces, { ...state.workspaces[0], id: 'workspace-b' }],
  }))
  const { view, switchTo } = element ? renderElementCaller(element) : renderCaller(useHook!)
  const spaceIds = (workspaceId: string) =>
    readWorkspaceDocument(workspaceId)
      ?.spaces.map(s => s.id)
      .filter(id => id.startsWith('marker-'))

  const write = (id: string) => {
    const args = argsOf()
    expect(args).toBeDefined()
    for (const channel of absent) {
      expect(Object.keys(args!)).not.toContain(channel)
    }
    const writer = args!.updateCanvasDocument as Updater | undefined
    expect(writer).toEqual(expect.any(Function))
    act(() => {
      writer!(({ nodes, spaces }) => ({ nodes, spaces: [...spaces, mark(id)] }))
    })
  }

  await act(async () => {
    await invoke(view.result.current)
  })
  expectsEveryAssignedNodeInTheDocument(assign)
  expectsOneFlushAfterThePushAway(flushSpy, 1, assign)
  write('marker-a')
  expect(spaceIds('workspace-a')).toEqual(['marker-a'])
  expect(spaceIds('workspace-b')).toEqual([])

  switchTo('workspace-b')
  await act(async () => {
    await invoke(view.result.current)
  })
  expectsEveryAssignedNodeInTheDocument(assign)
  expectsOneFlushAfterThePushAway(flushSpy, 2, assign)
  write('marker-b')
  expect(spaceIds('workspace-a')).toEqual(['marker-a'])
  expect(spaceIds('workspace-b')).toEqual(['marker-b'])
}
