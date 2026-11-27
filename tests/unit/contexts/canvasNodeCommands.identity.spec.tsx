import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import { useComposedCanvasNodeCommands } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeCommands'
import type { WiredCanvasNodeCommands } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import {
  useWorkspaceCanvasNodeTypeParameters,
  type WorkspaceCanvasNodeTypesParams,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'
import {
  readWorkspaceDocument,
  registerWorkspaceDocumentPersistFlush,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import {
  useReadCanvasSelection,
  useReadCanvasUi,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { CanvasStoreTestProvider } from '../../support/canvasStoreTestHarness'
import { setDocumentNodes } from '../../support/documentNodes'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from '../../support/workspaceCanvasStoreHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

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

const PREFERENCE_KEYS = [
  'workspacePath',
  'onShowMessage',
  'agentProviderOrder',
  'defaultProvider',
  'browserDefaultMode',
  'browserSearchEngine',
] as const

const onShowMessage = vi.fn()
const readAgentSettings = () => useAppStore.getState().agentSettings

let controls: { showWorkspace: (id: string) => void }

function CanvasHarness() {
  const [workspaceId, setWorkspaceId] = useState(A)
  controls = {
    showWorkspace: id => {
      useAppStore.setState({ activeWorkspaceId: id })
      setWorkspaceId(id)
    },
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

/** Runs `action`, and returns what the probe saw on the renders it caused. */
async function observe(action: () => void | Promise<void>): Promise<Seen[]> {
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

describe('the identity of the node commands and of the params value (Decision 3, amended by 14)', () => {
  const settingsWith = (patch: Partial<typeof DEFAULT_AGENT_SETTINGS>) =>
    act(() => {
      useAppStore.setState(state => ({ agentSettings: { ...state.agentSettings, ...patch } }))
    })

  // One row per cause. Each must render the canvas (the probe sees at least one render), and the
  // value the context holds on every one of those renders is the first one.
  const unchangedRows: Array<[string, () => void | Promise<void>]> = [
    [
      'a document write',
      () => {
        setDocumentNodes(A, [noteNode('a', 'a-text', 40), noteNode('b', 'b-text', 600)])
      },
    ],
    ['a select batch', () => void fireEvent.click(screen.getByTestId('select-a'))],
    ['a drag frame', () => void fireEvent.click(screen.getByTestId('drag-frame'))],
    [
      'a render with equal props (a new, equal settings object)',
      () => {
        useAppStore.setState(state => ({ agentSettings: { ...state.agentSettings } }))
      },
    ],
    [
      'a settings change that touches none of the six preferences (focusNodeTargetZoom)',
      () => {
        useAppStore.setState(state => ({
          agentSettings: { ...state.agentSettings, focusNodeTargetZoom: 0.6 },
        }))
      },
    ],
    [
      'a settings change of a field the commands read at call time (standardWindowSizeBucket)',
      () => {
        useAppStore.setState(state => ({
          agentSettings: { ...state.agentSettings, standardWindowSizeBucket: 'large' },
        }))
      },
    ],
  ]

  it.each(unchangedRows)(
    'keeps the params value and the commands across %s',
    async (_name, act1) => {
      await mount()
      const before = latest()

      const renders = await observe(act1)

      expect(renders.length).toBeGreaterThan(0)
      for (const snapshot of renders) {
        expect(snapshot.params).toBe(before.params)
        expect(snapshot.params.commands).toBe(before.params.commands)
        for (const key of PREFERENCE_KEYS) {
          expect(snapshot.params[key], key).toBe(before.params[key])
        }
      }
    },
  )

  it('keeps the family objects across the same rows, so a family consumer is not renewed either', async () => {
    await mount()
    const before = commandsOf()

    await observe(() => {
      useAppStore.setState(state => ({
        agentSettings: { ...state.agentSettings, focusNodeTargetZoom: 0.55 },
      }))
    })
    await observe(() => void fireEvent.click(screen.getByTestId('select-a')))

    expect(commandsOf().window).toBe(before.window)
    expect(commandsOf().note).toBe(before.note)
    expect(commandsOf().website).toBe(before.website)
  })

  // The one change besides the workspace: `useReactFlow()` returns a new instance once, when the
  // viewport initializes, and `focusForInteraction` calls through the instance. Only the window
  // family and what contains it change; the note and website families keep their objects.
  it('changes once when React Flow initializes its viewport: the window family and the object, not the others', async () => {
    await mount()
    const before = latest().params

    const renders = await observe(() => reactFlow.setState({ viewportInitialized: true }))

    const values = [...new Set(renders.map(snapshot => snapshot.params))]
    expect(values).toHaveLength(1)
    const after = values[0]!
    expect(after).not.toBe(before)
    expect(after.commands).not.toBe(before.commands)
    expect(after.commands.window).not.toBe(before.commands.window)
    expect(after.commands.note).toBe(before.commands.note)
    expect(after.commands.website).toBe(before.commands.website)
    for (const key of PREFERENCE_KEYS) {
      expect(after[key], key).toBe(before[key])
    }

    // And it stays put afterwards.
    const later = await observe(() => void fireEvent.click(screen.getByTestId('select-a')))
    expect(later.every(snapshot => snapshot.params === after)).toBe(true)
  })

  it('changes with the workspace: the params value, every family, and the path', async () => {
    await mount()
    const before = latest().params

    const renders = await observe(() => controls.showWorkspace(B))

    const after = latest().params
    expect(renders.length).toBeGreaterThan(0)
    expect(after).not.toBe(before)
    expect(after.commands).not.toBe(before.commands)
    expect(after.commands.window).not.toBe(before.commands.window)
    expect(after.commands.note).not.toBe(before.commands.note)
    expect(after.commands.website).not.toBe(before.commands.website)
    expect(after.workspacePath).toBe(`/tmp/${B}`)
    // The other five preferences are the settings', and the settings are the app's.
    expect(after.onShowMessage).toBe(before.onShowMessage)
    expect(after.agentProviderOrder).toBe(before.agentProviderOrder)
    expect(after.defaultProvider).toBe(before.defaultProvider)
    expect(after.browserDefaultMode).toBe(before.browserDefaultMode)
    expect(after.browserSearchEngine).toBe(before.browserSearchEngine)
  })

  it('changes a preference only when its content changes', async () => {
    await mount()
    const before = latest().params

    await settingsWith({
      browserDefaultMode: before.browserDefaultMode === 'iframe' ? 'native' : 'iframe',
    })

    const after = latest().params
    expect(after).not.toBe(before)
    expect(after.browserDefaultMode).not.toBe(before.browserDefaultMode)
    // The commands are not a preference: they keep their identity through it.
    expect(after.commands).toBe(before.commands)
    expect(after.agentProviderOrder).toBe(before.agentProviderOrder)
  })
})

describe('window.focusForInteraction reads the settings when it runs', () => {
  it('uses the zoom of the settings at the call, on the command that was made before they changed', async () => {
    useAppStore.setState(state => ({
      agentSettings: { ...state.agentSettings, focusNodeOnClick: true, focusNodeTargetZoom: 0.5 },
    }))
    await mount()
    const commands = commandsOf()

    act(() => commands.window.focusForInteraction('a'))
    expect(reactFlow.setCenter).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ zoom: 0.5 }),
    )

    // A tick of the zoom slider: the settings change, the command object does not.
    await observe(() => {
      useAppStore.setState(state => ({
        agentSettings: { ...state.agentSettings, focusNodeTargetZoom: 0.9 },
      }))
    })
    expect(commandsOf()).toBe(commands)

    act(() => commands.window.focusForInteraction('a'))
    expect(reactFlow.setCenter).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ zoom: 0.9 }),
    )
    expect(reactFlow.setCenter).toHaveBeenCalledTimes(2)
  })

  it('does nothing while "focus on click" is off, and starts again when it is turned on', async () => {
    useAppStore.setState(state => ({
      agentSettings: { ...state.agentSettings, focusNodeOnClick: false },
    }))
    await mount()
    const commands = commandsOf()

    act(() => commands.window.focusForInteraction('a'))
    expect(reactFlow.setCenter).not.toHaveBeenCalled()

    await observe(() => {
      useAppStore.setState(state => ({
        agentSettings: { ...state.agentSettings, focusNodeOnClick: true },
      }))
    })
    act(() => commands.window.focusForInteraction('a'))
    expect(reactFlow.setCenter).toHaveBeenCalledTimes(1)
  })

  it('centres on the window of its own workspace while another is displayed', async () => {
    useAppStore.setState(state => ({
      agentSettings: { ...state.agentSettings, focusNodeOnClick: true },
    }))
    await mount()
    const commandsOfA = commandsOf()
    await observe(() => controls.showWorkspace(B))
    reactFlow.setCenter.mockClear()
    // `a` sits at x 0 in A and in B; move it in A only.
    act(() => {
      setDocumentNodes(A, [noteNode('a', 'a-text', 4000), noteNode('b', 'b-text', 600)])
    })

    act(() => commandsOfA.window.focusForInteraction('a'))

    // The centre is A's node (x 4000 + half its width), not B's (x 0).
    expect(reactFlow.setCenter).toHaveBeenCalledWith(4150, expect.any(Number), expect.anything())
  })
})

describe('a command of workspace A that runs after the switch to B writes A (Decision 4)', () => {
  const noteText = (workspaceId: string, nodeId: string) => {
    const node = readWorkspaceDocument(workspaceId)?.nodes.find(
      candidate => candidate.id === nodeId,
    )
    return node?.data.note?.text
  }

  it('note.updateText writes the workspace of the node that made it', async () => {
    await mount()
    const commandsOfA = commandsOf()
    await observe(() => controls.showWorkspace(B))
    expect(latest().params.workspacePath).toBe(`/tmp/${B}`)

    act(() => commandsOfA.note.updateText('a', 'late text'))

    expect(noteText(A, 'a')).toBe('late text')
    expect(noteText(B, 'a')).toBe('B-text')
  })

  it('window.resize writes the workspace of the node that made it', async () => {
    await mount()
    const commandsOfA = commandsOf()
    const widthOf = (workspaceId: string) =>
      readWorkspaceDocument(workspaceId)?.nodes.find(node => node.id === 'a')?.data.width
    const widthInB = widthOf(B)
    await observe(() => controls.showWorkspace(B))

    act(() =>
      commandsOfA.window.resize('a', {
        position: { x: 0, y: 0 },
        size: { width: 520, height: 420 },
      }),
    )

    expect(widthOf(A)).toBe(520)
    expect(widthOf(B)).toBe(widthInB)
  })

  it('a command of B writes B after the switch, not A', async () => {
    await mount()
    await observe(() => controls.showWorkspace(B))

    act(() => commandsOf().note.updateText('a', 'in B'))

    expect(noteText(B, 'a')).toBe('in B')
    expect(noteText(A, 'a')).toBe('a-text')
  })
})

describe('the window commands reach the confirmation, the node store and the document', () => {
  it('requestDelete opens the confirmation for the windows the document holds, and writes no document', async () => {
    await mount()
    const documentBefore = readWorkspaceDocument(A)!

    await act(async () => commandsOf().window.requestDelete(['a', 'gone', 'b']))

    expect(latest().readUi().nodeDeleteConfirmation).toMatchObject({ nodeIds: ['a', 'b'] })
    expect(readWorkspaceDocument(A)!.nodes).toBe(documentBefore.nodes)
  })

  it('close closes a window of the document, requests one flush, and leaves the others', async () => {
    const flushes = vi.fn()
    const unregister = registerWorkspaceDocumentPersistFlush(flushes)
    await mount()

    await act(async () => commandsOf().window.close('b'))
    unregister()

    expect(readWorkspaceDocument(A)!.nodes.map(node => node.id)).toEqual(['a', 'w'])
    expect(flushes).toHaveBeenCalledTimes(1)
  })

  it('note.updateText, website.setPinned and window.setLabelColorOverride write the window they name', async () => {
    await mount()
    const commands = commandsOf()

    act(() => {
      commands.note.updateText('a', 'edited')
      commands.website.setPinned('w', true)
      commands.window.setLabelColorOverride(['b'], 'green')
    })

    const nodes = readWorkspaceDocument(A)!.nodes
    expect(nodes.find(node => node.id === 'a')?.data.note?.text).toBe('edited')
    expect(nodes.find(node => node.id === 'w')?.data.website?.pinned).toBe(true)
    expect(nodes.find(node => node.id === 'b')?.data.labelColorOverride).toBe('green')
  })
})

describe('a command called with an id the document no longer holds writes nothing about it', () => {
  // The window, note and website families, one row per command. `clearSelection` has no id.
  // Every row also reads the selection and the React Flow flag: they stay as they were (Invariant 2).
  // These ask for a persistence flush on every call, as they did before S7 (`flush: true` on the
  // write): nothing is written, so the flush persists what was already there.
  const FLUSHES_WITHOUT_A_WRITE = new Set([
    'window.setLabelColorOverride',
    'website.updateUrl',
    'website.setPinned',
    'website.setSession',
    'website.setMode',
    'website.setFullscreen',
  ])
  const table: Array<[string, (commands: WiredCanvasNodeCommands) => unknown]> = [
    ['window.select', c => c.window.select('gone')],
    ['window.select with toggle', c => c.window.select('gone', { toggle: true })],
    ['window.close', c => c.window.close('gone')],
    ['window.requestDelete', c => c.window.requestDelete(['gone'])],
    [
      'window.resize',
      c => c.window.resize('gone', { position: { x: 0, y: 0 }, size: { width: 500, height: 400 } }),
    ],
    ['window.focusForInteraction', c => c.window.focusForInteraction('gone')],
    ['window.setLabelColorOverride', c => c.window.setLabelColorOverride(['gone'], 'blue')],
    ['note.updateText', c => c.note.updateText('gone', 'text')],
    ['note.renameTitle', c => c.note.renameTitle('gone', 'title')],
    ['note.convertToTask', c => c.note.convertToTask('gone')],
    ['website.updateUrl', c => c.website.updateUrl('gone', 'https://other.example')],
    ['website.setPinned', c => c.website.setPinned('gone', true)],
    ['website.setSession', c => c.website.setSession('gone', 'incognito', null)],
    ['website.setMode', c => c.website.setMode('gone', 'native')],
    [
      'website.setFullscreen',
      c =>
        c.website.setFullscreen(
          'gone',
          { position: { x: 0, y: 0 }, size: { width: 800, height: 600 } },
          null,
          true,
        ),
    ],
  ]

  it.each(table)('%s', async (name, call) => {
    useAppStore.setState(state => ({
      agentSettings: { ...state.agentSettings, focusNodeOnClick: true },
    }))
    const notifications = vi.fn()
    const flushes = vi.fn()
    const unregister = registerWorkspaceDocumentPersistFlush(flushes)
    await mount()
    // Another window of the canvas stays selected: a write about the missing one must not touch it.
    await observe(() => void fireEvent.click(screen.getByTestId('select-a')))
    const commands = commandsOf()
    const { readSelection, readUi } = latest()
    expect(readSelection().nodeIds).toEqual(['a'])
    const documentBefore = readWorkspaceDocument(A)!
    const unsubscribe = useAppStore.subscribe(notifications)
    flushes.mockClear()

    await act(async () => {
      await call(commands)
    })
    unsubscribe()
    unregister()

    // The document: the same object, and no write reached the app store.
    expect(readWorkspaceDocument(A)!.nodes).toBe(documentBefore.nodes)
    expect(readWorkspaceDocument(A)!.spaces).toBe(documentBefore.spaces)
    expect(notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveBeenCalledTimes(FLUSHES_WITHOUT_A_WRITE.has(name) ? 1 : 0)
    // The canvas store: the selection, the dialog, and the viewport are as they were.
    expect(readSelection().nodeIds).toEqual(['a'])
    expect(reactFlow.state.nodesSelectionActive).toBe(true)
    expect(readUi().nodeDeleteConfirmation).toBeNull()
    expect(reactFlow.setCenter).not.toHaveBeenCalled()
  })
})

describe('the composition of the families (useComposedCanvasNodeCommands)', () => {
  function implementations() {
    return {
      selectNode: vi.fn(),
      clearNodeSelection: vi.fn(),
      requestNodeClose: vi.fn(async () => undefined),
      requestNodeDelete: vi.fn(),
      resizeNode: vi.fn(),
      setNodeLabelColorOverride: vi.fn(),
      updateNoteText: vi.fn(),
      renameNoteTitle: vi.fn(),
      convertNoteToTask: vi.fn(() => false),
      updateWebsiteUrl: vi.fn(),
      setWebsitePinned: vi.fn(),
      setWebsiteSession: vi.fn(),
      setWebsiteMode: vi.fn(),
      setWebsiteFullscreen: vi.fn(),
    }
  }

  function renderCommands() {
    const base = implementations()
    const instance = { setCenter: vi.fn() } as never
    const readSettings = () => DEFAULT_AGENT_SETTINGS
    return {
      base,
      ...renderHook(
        (props: ReturnType<typeof implementations>) =>
          useComposedCanvasNodeCommands({
            reactFlow: instance,
            readAgentSettings: readSettings,
            ...props,
          }),
        {
          initialProps: base,
          wrapper: ({ children }) => <CanvasStoreTestProvider>{children}</CanvasStoreTestProvider>,
        },
      ),
    }
  }

  it('returns the same object, and the same families, for the same functions', () => {
    const { result, rerender, base } = renderCommands()
    const first = result.current

    rerender({ ...base })

    expect(result.current).toBe(first)
    expect(result.current.window).toBe(first.window)
    expect(result.current.note).toBe(first.note)
    expect(result.current.website).toBe(first.website)
  })

  it.each([
    ['selectNode', 'window'],
    ['clearNodeSelection', 'window'],
    ['requestNodeClose', 'window'],
    ['requestNodeDelete', 'window'],
    ['resizeNode', 'window'],
    ['setNodeLabelColorOverride', 'window'],
    ['updateNoteText', 'note'],
    ['renameNoteTitle', 'note'],
    ['convertNoteToTask', 'note'],
    ['updateWebsiteUrl', 'website'],
    ['setWebsitePinned', 'website'],
    ['setWebsiteSession', 'website'],
    ['setWebsiteMode', 'website'],
    ['setWebsiteFullscreen', 'website'],
  ] as const)('renews %s: its family and the object, and no other family', (name, family) => {
    const { result, rerender, base } = renderCommands()
    const first = result.current

    rerender({ ...base, [name]: vi.fn() })

    expect(result.current).not.toBe(first)
    for (const other of ['window', 'note', 'website'] as const) {
      if (other === family) {
        expect(result.current[other], other).not.toBe(first[other])
      } else {
        expect(result.current[other], other).toBe(first[other])
      }
    }
  })

  it('binds each command to the function it is named for', async () => {
    const { result, base } = renderCommands()
    const commands = result.current

    commands.window.select('x', { toggle: true })
    commands.window.clearSelection()
    await commands.window.close('x')
    commands.window.requestDelete(['x'])
    commands.note.updateText('x', 't')
    commands.website.setPinned('x', true)

    expect(base.selectNode).toHaveBeenCalledWith('x', { toggle: true })
    expect(base.clearNodeSelection).toHaveBeenCalledTimes(1)
    expect(base.requestNodeClose).toHaveBeenCalledWith('x')
    expect(base.requestNodeDelete).toHaveBeenCalledWith(['x'])
    expect(base.updateNoteText).toHaveBeenCalledWith('x', 't')
    expect(base.setWebsitePinned).toHaveBeenCalledWith('x', true)
  })
})
