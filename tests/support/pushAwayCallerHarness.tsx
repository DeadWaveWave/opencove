import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { expect, vi, type Mock } from 'vitest'
import { useAppStore } from '../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasNodesStore } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import { readWorkspaceDocument } from '../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { useCanvasUiCommands } from '../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../src/contexts/workspace/presentation/renderer/types'
import { createCanvasDocumentHarness, renderInCanvasDocument } from './canvasDocumentHarness'
import { useWorkspaceCanvasStoreNodes } from './workspaceCanvasStoreHarness'

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

export const spacesRef = { current: [TARGET] }
export const nodesRef = { current: [] as Node<TerminalNodeData>[] }

export function lastCall(mock: unknown): unknown[] {
  const calls = (mock as Mock).mock.calls
  return calls[calls.length - 1] ?? []
}

export type Updater = ReturnType<typeof useWorkspaceCanvasNodesStore>['updateCanvasDocument']

const onNodesCommitted = vi.fn()

function useShownNodeStore(shown: string) {
  const nodes = useWorkspaceCanvasStoreNodes(shown)
  return useWorkspaceCanvasNodesStore({
    workspaceId: shown,
    workspacePath: `/tmp/${shown}`,
    nodes,
    spacesRef,
    onNodesCommitted,
    isLiveGestureActive: () => false,
    standardWindowSizeBucket: 'regular',
    browserDefaultMode: 'iframe',
  })
}

/**
 * `renderHook` under the canvas store provider of the workspace shown. `useHook` gets the document
 * writer of the node store of that render, as the canvas hands it to its hooks; `switchTo` shows
 * another workspace and renders again.
 */
export function renderCaller<Result>(useHook: (updateCanvasDocument: Updater) => Result) {
  let shown = 'workspace-a'
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
        view.rerender()
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
  invoke,
  argsOf,
  absent = OLD_CHANNELS,
  flush,
  assign,
}: {
  useHook: (updateCanvasDocument: Updater) => Result
  invoke: Invoke<Result>
  argsOf: () => Record<string, unknown> | undefined
  absent?: string[]
  /** The caller flushes once after the push-away, as it did before. */
  flush?: Mock
  /** The mocked push-away, to order the flush after it. */
  assign: Mock
}) {
  createCanvasDocumentHarness({ workspaceId: 'workspace-a' })
  useAppStore.setState(state => ({
    workspaces: [...state.workspaces, { ...state.workspaces[0], id: 'workspace-b' }],
  }))
  const { view, switchTo } = renderCaller(useHook)
  const spaceIds = (workspaceId: string) =>
    readWorkspaceDocument(workspaceId)?.spaces.map(s => s.id)

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
  expectsOneFlushAfterThePushAway(flush, 1, assign)
  write('marker-a')
  expect(spaceIds('workspace-a')).toEqual(['marker-a'])
  expect(spaceIds('workspace-b')).toEqual([])

  switchTo('workspace-b')
  await act(async () => {
    await invoke(view.result.current)
  })
  expectsOneFlushAfterThePushAway(flush, 2, assign)
  write('marker-b')
  expect(spaceIds('workspace-a')).toEqual(['marker-a'])
  expect(spaceIds('workspace-b')).toEqual(['marker-b'])
}
