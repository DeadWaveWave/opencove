import React, { useState } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import type { WiredCanvasNodeCommands } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import {
  useWorkspaceCanvasNodeTypeParameters,
  type WorkspaceCanvasNodeTypesParams,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'
import { readWorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import {
  useReadCanvasSelection,
  useReadCanvasUi,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from '../../support/workspaceCanvasStoreHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

// S7 of #647 (review of PR 4), on the identity spec's harness: every command of the
// window, note and website families, called through the canvas with an id the document holds,
// has the effect of the function it is named for, so that two functions of one signature cannot
// be swapped unnoticed.
//
// S7 of #647, Decision 3 and its amendment (Decision 14): node components read the canvas's
// commands from context, and the whole params value they read keeps its identity until the
// workspace or its configuration changes. This spec mounts the real canvas on a faithful React
// Flow mock and records every value a consumer of the context sees, on every render of the host.

const reactFlow = vi.hoisted(() => {
  // One spy for both instances: React Flow's `useReactFlow()` returns a new instance once, when
  // the viewport initializes (`viewportInitialized`), and the commands follow it.
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
reactFlow.storeApi = {
  getState: () => reactFlow.state,
  setState: reactFlow.setState,
  subscribe: reactFlow.subscribe,
}

vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const { useSyncExternalStore, useRef } = await import('react')
  // Equal by content keeps the same snapshot, as React Flow's shallow equality does.
  const useFlowStore = <T,>(selector: (state: Record<string, unknown>) => T): T => {
    const cache = useRef<{ value: T } | null>(null)
    const read = (): T => {
      const next = selector(reactFlow.state)
      if (cache.current && JSON.stringify(cache.current.value) === JSON.stringify(next)) {
        return cache.current.value
      }
      cache.current = { value: next }
      return next
    }
    return useSyncExternalStore(reactFlow.subscribe, read, read)
  }
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () =>
      useFlowStore(state => state.viewportInitialized === true)
        ? reactFlow.instanceAfterInit
        : reactFlow.instanceBeforeInit,
    useStore: useFlowStore,
    useStoreApi: () => reactFlow.storeApi,
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
      reactFlow.state.nodes = nodes
      const Probe = reactFlow.Probe
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

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals',
  () => ({ WorkspaceWindowSignals: () => null }),
)

const A = 'workspace-a'
const B = 'workspace-b'

interface Seen {
  params: WorkspaceCanvasNodeTypesParams
  readSelection: () => { nodeIds: readonly string[] }
  readUi: () => { nodeDeleteConfirmation: unknown }
}
const seen: Seen[] = []

// Rendered by the React Flow mock, so it renders whenever the canvas does, whether or not the
// context value changed: what it records is the value the context holds on that render.
function ParamsProbe(): null {
  const params = useWorkspaceCanvasNodeTypeParameters()
  const readSelection = useReadCanvasSelection()
  const readUi = useReadCanvasUi()
  seen.push({ params, readSelection, readUi })
  return null
}
reactFlow.Probe = ParamsProbe

const latest = (): Seen => seen[seen.length - 1]!
const commandsOf = (): WiredCanvasNodeCommands => latest().params.commands

const onShowMessage = vi.fn()
const readAgentSettings = () => useAppStore.getState().agentSettings

function CanvasHarness() {
  const [workspaceId] = useState(A)
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
      onAppendSpaceArchiveRecord={() => undefined}
      onChangePreserveWindowSizesOnArrange={() => undefined}
    />
  )
}

// No `type`: the React Flow mock renders no window for these, so the spec reads the commands and
// not a node.
const noteNode = (id: string, text: string, x: number): Node<TerminalNodeData> => ({
  ...pixelNode({ kind: 'note', sessionId: '', title: id, note: { text } }),
  id,
  position: { x, y: 0 },
  // The size the node store would add with its first write, so that "nothing" stays nothing.
  initialWidth: 300,
  initialHeight: 200,
})
const websiteNode = (id: string, x: number): Node<TerminalNodeData> => ({
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
const documentOfA = () => [
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

async function mount(): Promise<void> {
  seen.length = 0
  render(<CanvasHarness />)
  await act(async () => {})
  expect(seen.length).toBeGreaterThan(0)
}

function stubOpencoveApi(): void {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    writable: true,
    value: {
      pty: {
        spawn: vi.fn(),
        kill: vi.fn(async () => undefined),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
        onState: vi.fn(() => () => undefined),
        onMetadata: vi.fn(() => () => undefined),
      },
      workspace: { ensureDirectory: vi.fn(async () => undefined) },
      agent: { launch: vi.fn() },
      task: { suggestTitle: vi.fn() },
    },
  })
}

beforeEach(() => {
  stubOpencoveApi()
  seedTwoWorkspaces()
  reactFlow.setCenter.mockClear()
  reactFlow.setState({
    viewportInitialized: false,
    nodesSelectionActive: false,
    userSelectionActive: false,
  })
})
afterEach(() => {
  cleanup()
  seen.length = 0
})

describe('each wired command has its own effect, through the canvas', () => {
  const nodeOf = (id: string) => readWorkspaceDocument(A)!.nodes.find(node => node.id === id)!

  it('note.updateText changes the text and not the title', async () => {
    await mount()
    act(() => commandsOf().note.updateText('a', 'new text'))
    expect(nodeOf('a').data.note?.text).toBe('new text')
    expect(nodeOf('a').data.title).toBe('a')
  })

  it('note.renameTitle changes the title, pins it, and not the text', async () => {
    await mount()
    act(() => commandsOf().note.renameTitle('a', 'New Title'))
    expect(nodeOf('a').data.title).toBe('New Title')
    expect(nodeOf('a').data.titlePinnedByUser).toBe(true)
    expect(nodeOf('a').data.note?.text).toBe('a-text')
  })

  it('note.convertToTask turns the note into a task', async () => {
    await mount()
    let converted = false
    act(() => {
      converted = commandsOf().note.convertToTask('a')
    })
    expect(converted).toBe(true)
    expect(nodeOf('a').data.kind).toBe('task')
  })

  it.each([
    [
      'updateUrl',
      (c: WiredCanvasNodeCommands) => c.website.updateUrl('w', 'https://other.example'),
      { url: 'https://other.example' },
    ],
    ['setPinned', (c: WiredCanvasNodeCommands) => c.website.setPinned('w', true), { pinned: true }],
    [
      'setSession',
      (c: WiredCanvasNodeCommands) => c.website.setSession('w', 'profile', 'p1'),
      { sessionMode: 'profile', profileId: 'p1' },
    ],
    [
      'setMode',
      (c: WiredCanvasNodeCommands) => c.website.setMode('w', 'native'),
      { browserMode: 'native' },
    ],
  ] as const)('website.%s writes its own field of the website', async (_name, call, expected) => {
    await mount()
    const before = { ...nodeOf('w').data.website }
    act(() => {
      call(commandsOf())
    })
    expect(nodeOf('w').data.website).toEqual({
      ...before,
      ...nodeOf('w').data.website,
      ...expected,
    })
    for (const [key, value] of Object.entries(before)) {
      if (!(key in expected)) {
        expect((nodeOf('w').data.website as Record<string, unknown>)[key], key).toEqual(value)
      }
    }
  })

  it('website.setFullscreen moves the window to the frame', async () => {
    await mount()
    act(() =>
      commandsOf().website.setFullscreen(
        'w',
        { position: { x: 7, y: 9 }, size: { width: 900, height: 700 } },
        null,
        true,
      ),
    )
    expect(nodeOf('w').position).toEqual({ x: 7, y: 9 })
    expect(nodeOf('w').data.width).toBe(900)
  })

  it('window.select selects the window alone, and window.clearSelection clears it', async () => {
    await mount()
    act(() => commandsOf().window.select('b'))
    expect(latest().readSelection().nodeIds).toEqual(['b'])
    act(() => commandsOf().window.select('a', { toggle: true }))
    expect(latest().readSelection().nodeIds).toEqual(['a', 'b'])
    act(() => commandsOf().window.clearSelection())
    expect(latest().readSelection().nodeIds).toEqual([])
    expect(reactFlow.state.nodesSelectionActive).toBe(false)
  })
})
