import React, { useState } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../src/app/renderer/shell/store/useAppStore'
import type { TerminalClientDisplayCalibration } from '../../src/contexts/settings/domain/terminalDisplayCalibration'
import { WorkspaceCanvas } from '../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import type { WiredCanvasNodeCommands } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import {
  useWorkspaceCanvasNodeTypeParameters,
  type WorkspaceCanvasNodeTypesParams,
} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'
import {
  useReadCanvasSelection,
  useReadCanvasUi,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { useScrollbackStore } from '../../src/contexts/workspace/presentation/renderer/store/useScrollbackStore'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '../../src/contexts/workspace/presentation/renderer/types'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from './workspaceCanvasStoreHarness'
import { pixelNode } from '../unit/contexts/workspacePixelLayer.fixtures'

// The harness of the node commands specs (S7 of #647): the real canvas mounted on a faithful React
// Flow mock, two workspaces (A with two notes and a website, B with its own `a` and `b`), a probe
// that records every params value a consumer of the context sees, and the IPC stub.
//
// A spec that uses it imports it before any production module: it registers `vi.mock` for
// `@xyflow/react`, the scrollback schedule and the window signals, and a mock applies to the
// modules that are evaluated after it. It calls `installCanvasHarnessHooks()` at its top level.

const reactFlowState = vi.hoisted(() => {
  // What `@xyflow/react` 12.10.1 does (`dist/esm/index.mjs:499` and `:1203-1210`): the object that
  // `useReactFlow()` returns is renewed once, when `viewportInitialized` flips, but its viewport
  // helpers (`setViewport`, `setCenter`, `getViewport`, `screenToFlowPosition`) come from
  // `useViewportHelper`, memoised with `[]`, so they keep their identity. The two instances here
  // are two objects that share the same helper functions.
  const setCenter = vi.fn()
  const methods = {
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: () => undefined,
    setCenter,
  }
  const state: Record<string, unknown> = {
    nodes: [],
    transform: [0, 0, 1],
    userSelectionActive: false,
    nodesSelectionActive: false,
    viewportInitialized: false,
  }
  const listeners = new Set<(state: Record<string, unknown>) => void>()
  return {
    setCenter,
    instanceBeforeInit: { ...methods },
    instanceAfterInit: { ...methods },
    state,
    setState: (partial: Record<string, unknown>) => {
      Object.assign(state, partial)
      listeners.forEach(listener => listener(state))
    },
    subscribe: (listener: (state: Record<string, unknown>) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    Probe: null as null | React.ComponentType,
    // One object, as the provider's own store is: a new one per call would renew every callback
    // that depends on it.
    storeApi: null as unknown as {
      getState: () => Record<string, unknown>
      setState: (partial: Record<string, unknown>) => void
      subscribe: (listener: (state: Record<string, unknown>) => void) => () => void
    },
  }
})
reactFlowState.storeApi = {
  getState: () => reactFlowState.state,
  setState: reactFlowState.setState,
  subscribe: reactFlowState.subscribe,
}

vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const { useSyncExternalStore, useRef } = await import('react')
  // Equal by content keeps the same snapshot, as React Flow's shallow equality does.
  const useFlowStore = <T,>(selector: (state: Record<string, unknown>) => T): T => {
    const cache = useRef<{ value: T } | null>(null)
    const read = (): T => {
      const next = selector(reactFlowState.state)
      if (cache.current && JSON.stringify(cache.current.value) === JSON.stringify(next)) {
        return cache.current.value
      }
      cache.current = { value: next }
      return next
    }
    return useSyncExternalStore(reactFlowState.subscribe, read, read)
  }
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () =>
      useFlowStore(state => state.viewportInitialized === true)
        ? reactFlowState.instanceAfterInit
        : reactFlowState.instanceBeforeInit,
    useStore: useFlowStore,
    useStoreApi: () => reactFlowState.storeApi,
    ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    applyNodeChanges: actual.applyNodeChanges,
    ReactFlow: ({
      nodes,
      onNodesChange,
      children,
    }: {
      nodes: Array<{ id: string; selected?: boolean }>
      children?: React.ReactNode
      onNodesChange?: (changes: unknown[]) => void
    }) => {
      reactFlowState.state.nodes = nodes
      const Probe = reactFlowState.Probe
      return (
        <div>
          <button
            type="button"
            data-testid="select-a"
            onClick={() => onNodesChange?.([{ type: 'select', id: 'a', selected: true }])}
          />
          <button
            type="button"
            data-testid="drag-frame"
            onClick={() =>
              onNodesChange?.([
                { type: 'position', id: 'a', position: { x: 30, y: 20 }, dragging: true },
              ])
            }
          />
          {Probe ? <Probe /> : null}
          {children}
        </div>
      )
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    BackgroundVariant: { Dots: 'dots' },
    SelectionMode: { Partial: 'partial' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    PanOnScrollMode: { Free: 'free' },
    Handle: () => null,
    Position: { Left: 'left', Right: 'right' },
  }
})

// The scrollback of a node that is written to disk later: the scheduler is the persistence's.
const scheduledScrollbacksState = vi.hoisted(() => [] as Array<[string, string | null]>)
vi.mock(
  '../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule',
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    scheduleNodeScrollbackWrite: vi.fn((nodeId: string, scrollback: string | null) => {
      scheduledScrollbacksState.push([nodeId, scrollback])
    }),
  }),
)

vi.mock(
  '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals',
  () => ({ WorkspaceWindowSignals: vi.fn(() => null) }),
)

export const A = 'workspace-a'
export const B = 'workspace-b'

export interface Seen {
  params: WorkspaceCanvasNodeTypesParams
  readSelection: () => { nodeIds: readonly string[] }
  readUi: () => { nodeDeleteConfirmation: unknown }
}
export const seen: Seen[] = []

// Rendered by the React Flow mock, so it renders whenever the canvas does, whether or not the
// context value changed: what it records is the value the context holds on that render.
function ParamsProbe(): null {
  const params = useWorkspaceCanvasNodeTypeParameters()
  const readSelection = useReadCanvasSelection()
  const readUi = useReadCanvasUi()
  seen.push({ params, readSelection, readUi })
  return null
}
reactFlowState.Probe = ParamsProbe

export const latest = (): Seen => seen[seen.length - 1]!
export const commandsOf = (): WiredCanvasNodeCommands => latest().params.commands

export const PREFERENCE_KEYS = [
  'workspacePath',
  'onShowMessage',
  'agentProviderOrder',
  'defaultProvider',
  'browserDefaultMode',
  'browserSearchEngine',
] as const

export const onShowMessage = vi.fn()
const readAgentSettings = () => useAppStore.getState().agentSettings
let appliedCalibration: TerminalClientDisplayCalibration | null = null
const readCalibration = () => appliedCalibration

export let controls: {
  showWorkspace: (id: string) => void
  setCalibration: (calibration: TerminalClientDisplayCalibration | null) => void
  setEnv: (env: Record<string, string>) => void
}

function CanvasHarness() {
  const [workspaceId, setWorkspaceId] = useState(A)
  const [calibrationValue, setCalibration] = useState<TerminalClientDisplayCalibration | null>(null)
  const [env, setEnv] = useState<Record<string, string> | undefined>(undefined)
  controls = {
    showWorkspace: id => {
      useAppStore.setState({ activeWorkspaceId: id })
      setWorkspaceId(id)
    },
    setCalibration: next => {
      appliedCalibration = next
      setCalibration(next)
    },
    setEnv,
  }
  const agentSettings = useAppStore(state => state.agentSettings)
  const nodes = useWorkspaceCanvasStoreNodes(workspaceId)
  return (
    <WorkspaceCanvas
      workspaceId={workspaceId}
      workspacePath={`/tmp/${workspaceId}`}
      worktreesRoot=""
      nodes={nodes}
      spaces={[]}
      activeSpaceId={null}
      onActiveSpaceChange={() => undefined}
      onShowMessage={onShowMessage}
      viewport={{ x: 0, y: 0, zoom: 1 }}
      isMinimapVisible={false}
      onViewportChange={() => undefined}
      onMinimapVisibilityChange={() => undefined}
      agentSettings={agentSettings}
      readAgentSettings={readAgentSettings}
      environmentVariables={env}
      terminalDisplayCalibration={calibrationValue}
      readTerminalDisplayCalibration={readCalibration}
      onAppendSpaceArchiveRecord={() => undefined}
      onChangePreserveWindowSizesOnArrange={() => undefined}
    />
  )
}

// No `type`: the React Flow mock renders no window; the spec reads the commands.
export const noteNode = (id: string, text: string, x: number): Node<TerminalNodeData> => ({
  ...pixelNode({ kind: 'note', sessionId: '', title: id, note: { text } }),
  id,
  position: { x, y: 0 },
  // The size the node store would add with its first write, so that "nothing" stays nothing.
  initialWidth: 300,
  initialHeight: 200,
})
export const websiteNode = (id: string, x: number): Node<TerminalNodeData> => ({
  ...pixelNode({
    kind: 'website',
    sessionId: '',
    title: id,
    website: {
      url: 'https://example.com',
      pinned: false,
      sessionMode: 'shared',
      profileId: null,
      browserMode: 'iframe',
    },
  }),
  id,
  position: { x, y: 0 },
  initialWidth: 300,
  initialHeight: 200,
})
export const documentOfA = () => [
  noteNode('a', 'a-text', 0),
  noteNode('b', 'b-text', 600),
  websiteNode('w', 1200),
]
const documentOfB = () => [noteNode('a', 'B-text', 0), noteNode('b', 'B-b-text', 600)]

function seedTwoWorkspaces(): void {
  seedWorkspaceCanvasStore({ workspaceId: A, nodes: documentOfA() })
  useAppStore.setState(state => ({
    workspaces: [
      ...state.workspaces,
      {
        ...state.workspaces[0],
        id: B,
        name: B,
        path: `/tmp/${B}`,
        nodes: documentOfB(),
        spaces: [],
      } as WorkspaceState,
    ],
  }))
}

export async function mount(): Promise<void> {
  seen.length = 0
  render(<CanvasHarness />)
  await act(async () => {})
  expect(seen.length).toBeGreaterThan(0)
}

/** Runs `action`, and returns what the probe saw on the renders it caused. */
export async function observe(action: () => void | Promise<void>): Promise<Seen[]> {
  const mark = seen.length
  await act(async () => {
    await action()
  })
  // Let a frame-scheduled write (a drag frame) render too.
  await act(async () => {
    await new Promise(resolve => window.requestAnimationFrame(() => resolve(undefined)))
  })
  return seen.slice(mark)
}

// What a terminal command reaches outside the document; the closed-node table pins it untouched.
export const ipc = {
  launch: vi.fn(),
  kill: vi.fn(async () => undefined),
  reexecAgent: vi.fn(),
  listSessions: vi.fn(),
  readLastMessage: vi.fn(),
  invoke: vi.fn(),
  writeText: vi.fn(),
}

function stubOpencoveApi(): void {
  Object.values(ipc).forEach(mock => mock.mockClear())
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    writable: true,
    value: {
      pty: {
        spawn: vi.fn(),
        kill: ipc.kill,
        reexecAgent: ipc.reexecAgent,
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
        onState: vi.fn(() => () => undefined),
        onMetadata: vi.fn(() => () => undefined),
      },
      workspace: { ensureDirectory: vi.fn(async () => undefined) },
      agent: {
        launch: ipc.launch,
        listSessions: ipc.listSessions,
        readLastMessage: ipc.readLastMessage,
      },
      controlSurface: { invoke: ipc.invoke },
      clipboard: { writeText: ipc.writeText },
      task: { suggestTitle: vi.fn() },
    },
  })
}

/** Registers the harness's hooks in the spec file that calls it. */
export function installCanvasHarnessHooks(): void {
  // A `vi.mock` path that resolves to nothing mocks nothing and fails nothing: the closed-node
  // table's "no scrollback scheduled" would then pass for any command. This row fails loudly.
  it('applies the mocks it registers (a path that resolves to nothing would mock nothing)', async () => {
    const schedule =
      await import('../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule')
    const signals =
      await import('../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals')
    expect(vi.isMockFunction(schedule.scheduleNodeScrollbackWrite)).toBe(true)
    expect(vi.isMockFunction(signals.WorkspaceWindowSignals)).toBe(true)
    schedule.scheduleNodeScrollbackWrite('guard', 'x')
    expect(scheduledScrollbacksState).toEqual([['guard', 'x']])
  })

  beforeEach(() => {
    appliedCalibration = null
    stubOpencoveApi()
    scheduledScrollbacksState.length = 0
    useScrollbackStore.getState().clearAllScrollbacks()
    seedTwoWorkspaces()
    reactFlowState.setCenter.mockClear()
    reactFlowState.setState({
      viewportInitialized: false,
      nodesSelectionActive: false,
      userSelectionActive: false,
    })
  })
  afterEach(() => {
    cleanup()
    seen.length = 0
  })
}

/** The React Flow mock's handle: its state, its probe, and `setCenter`. */
export const reactFlow = reactFlowState
/** What the scrollback scheduler was asked to write. */
export const scheduledScrollbacks = scheduledScrollbacksState
