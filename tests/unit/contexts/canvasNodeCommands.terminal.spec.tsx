import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import type { TerminalClientDisplayCalibration } from '../../../src/contexts/settings/domain/terminalDisplayCalibration'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import type { CanvasNodeCommands } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import {
  useWorkspaceCanvasNodeTypeParameters,
  type WorkspaceCanvasNodeTypesParams,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'
import {
  readWorkspaceDocument,
  registerWorkspaceDocumentPersistFlush,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { useScrollbackStore } from '../../../src/contexts/workspace/presentation/renderer/store/useScrollbackStore'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { terminalCalibration } from '../../support/terminalCalibration'
import { agentNode } from '../../support/agentRuntimeHarness'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from '../../support/workspaceCanvasStoreHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

// S7 of #647, PR 5: the terminal family, called through the real canvas on the identity spec's
// faithful React Flow mock. What this spec pins:
//   - a terminal of workspace A that publishes its scrollback after the switch to B lands in A's
//     scrollback store (Decision 4: the workspace is the render's that made the command);
//   - the launch fields are read from the app's settings when a reload or a switch starts, and a
//     change of them keeps the command object (Decision 2);
//   - a switch during the await of a reload or a session switch writes A only.

const scheduled = vi.hoisted(() => ({ writes: [] as Array<[string, string | null]> }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule',
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    scheduleNodeScrollbackWrite: (nodeId: string, scrollback: string | null) => {
      scheduled.writes.push([nodeId, scrollback])
    },
  }),
)

const reactFlow = vi.hoisted(() => {
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

const seen: WorkspaceCanvasNodeTypesParams[] = []
function ParamsProbe(): null {
  seen.push(useWorkspaceCanvasNodeTypeParameters())
  return null
}
reactFlow.Probe = ParamsProbe
const commandsOf = (): CanvasNodeCommands => seen[seen.length - 1]!.commands

const onShowMessage = vi.fn()
const readAgentSettings = () => useAppStore.getState().agentSettings
let appliedCalibration: TerminalClientDisplayCalibration | null = null
const readCalibration = () => appliedCalibration

let controls: {
  showWorkspace: (id: string) => void
  setCalibration: (calibration: TerminalClientDisplayCalibration | null) => void
}

function CanvasHarness() {
  const [workspaceId, setWorkspaceId] = useState(A)
  const [calibration, setCalibration] = useState<TerminalClientDisplayCalibration | null>(null)
  controls = {
    showWorkspace: id => {
      useAppStore.setState({ activeWorkspaceId: id })
      setWorkspaceId(id)
    },
    setCalibration: next => {
      appliedCalibration = next
      setCalibration(next)
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
      terminalDisplayCalibration={calibration}
      readTerminalDisplayCalibration={readCalibration}
      onAppendSpaceArchiveRecord={() => undefined}
      onChangePreserveWindowSizesOnArrange={() => undefined}
    />
  )
}

// A terminal and an agent window in A. B holds neither the terminal nor the same agent: its `ag`
// has other data, so a write of A's command that reached B would show.
const terminalOfA = () => ({
  ...pixelNode({ kind: 'terminal', sessionId: 'pty-t', title: 'term' }),
  id: 't',
  initialWidth: 300,
  initialHeight: 200,
})
const agentOfA = () =>
  agentNode('ag', { title: 'agent of A' }, { executionDirectory: '/repo-a', provider: 'codex' })
// A terminal that an agent runs in (the overlay): the invocation that started at 100.
const overlayOfA = () => ({
  ...pixelNode({
    kind: 'terminal',
    sessionId: 'pty-ov',
    title: 'overlay',
    executionDirectory: '/repo-ov',
    terminalAgentBinding: {
      provider: 'codex',
      resumeSessionId: 'resume-ov',
      resumeSessionIdVerified: true,
    },
    agentOverlay: { provider: 'codex', status: 'standby', startedAtMs: 100 },
  }),
  id: 'ov',
  initialWidth: 300,
  initialHeight: 200,
})
const agentOfB = () =>
  agentNode(
    'ag',
    { title: 'agent of B', sessionId: 'b-runtime' },
    { executionDirectory: '/repo-b' },
  )

function seedTwoWorkspaces(): void {
  seedWorkspaceCanvasStore({
    workspaceId: A,
    nodes: [terminalOfA(), agentOfA(), overlayOfA()],
  })
  useAppStore.setState(state => ({
    workspaces: [
      ...state.workspaces,
      {
        ...state.workspaces[0],
        id: B,
        name: B,
        path: `/tmp/${B}`,
        nodes: [agentOfB()],
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

// What a launch answers, and what the IPC saw. `release` holds the launch until a case lets it go.
interface Api {
  launch: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  release: () => void
}
function stubOpencoveApi({ hold = false } = {}): Api {
  let release: () => void = () => undefined
  const gate = hold
    ? new Promise<void>(resolve => {
        release = resolve
      })
    : Promise.resolve()
  const launch = vi.fn(async () => {
    await gate
    return {
      sessionId: 'runtime-new',
      profileId: null,
      runtimeKind: 'posix',
      effectiveModel: 'gpt-5.2-codex',
      resumeSessionId: null,
    }
  })
  const kill = vi.fn(async () => undefined)
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    writable: true,
    value: {
      pty: {
        spawn: vi.fn(),
        kill,
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
        onState: vi.fn(() => () => undefined),
        onMetadata: vi.fn(() => () => undefined),
      },
      workspace: { ensureDirectory: vi.fn(async () => undefined) },
      agent: { launch },
      task: { suggestTitle: vi.fn() },
    },
  })
  return { launch, kill, release }
}

const settingsWith = (patch: Partial<AgentSettings>) =>
  act(() => {
    useAppStore.setState(state => ({ agentSettings: { ...state.agentSettings, ...patch } }))
  })

beforeEach(() => {
  appliedCalibration = null
  stubOpencoveApi()
  scheduled.writes.length = 0
  useScrollbackStore.getState().clearAllScrollbacks()
  useAppStore.setState({ agentSettings: { ...DEFAULT_AGENT_SETTINGS } })
  seedTwoWorkspaces()
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

const nodeOf = (workspaceId: string, nodeId: string) =>
  readWorkspaceDocument(workspaceId)?.nodes.find(node => node.id === nodeId)

describe('the scrollback of a terminal of A, published after the switch to B (Decision 4)', () => {
  it('lands in the scrollback store of the terminal that made it, and in nothing of B', async () => {
    await mount()
    const commandsOfA = commandsOf()
    await act(async () => controls.showWorkspace(B))

    act(() => commandsOfA.terminal.updateScrollback('t', 'output of a'))

    // The store is keyed by node: A's terminal has its output, and no other entry appeared.
    expect(useScrollbackStore.getState().scrollbackByNodeId).toEqual({ t: 'output of a' })
    expect(scheduled.writes).toEqual([['t', 'output of a']])
  })

  it('is not held back for a drag of B, which has no part in it', async () => {
    await mount()
    const commandsOfA = commandsOf()
    await act(async () => controls.showWorkspace(B))
    // A frame of a drag in B: the node store's drag flag is up, so the shown canvas defers.
    await act(async () => void fireEvent.click(screen.getByTestId('drag-frame')))

    act(() => commandsOfA.terminal.updateScrollback('t', 'late output of a'))

    expect(useScrollbackStore.getState().scrollbackByNodeId).toEqual({ t: 'late output of a' })
  })

  it('still waits for the drag of its own canvas (the change path publishes it when the gesture ends)', async () => {
    await mount()
    await act(async () => void fireEvent.click(screen.getByTestId('drag-frame')))

    act(() => commandsOf().terminal.updateScrollback('t', 'during the drag'))

    expect(useScrollbackStore.getState().scrollbackByNodeId).toEqual({})
  })

  it('a command of B stores nothing for a terminal that only A holds', async () => {
    await mount()
    await act(async () => controls.showWorkspace(B))

    act(() => commandsOf().terminal.updateScrollback('t', 'output'))

    expect(useScrollbackStore.getState().scrollbackByNodeId).toEqual({})
  })
})

describe('the launch fields are read from the settings when a reload starts', () => {
  const rows: Array<
    [string, Partial<AgentSettings>, (payload: Record<string, unknown>) => unknown, unknown]
  > = [
    ['agentFullAccess', { agentFullAccess: true }, payload => payload.agentFullAccess, true],
    [
      'codexReuseRunningAppServer',
      { codexReuseRunningAppServer: true },
      payload => payload.codexReuseRunningAppServer,
      true,
    ],
    [
      'defaultTerminalProfileId',
      { defaultTerminalProfileId: 'wsl:Debian' },
      payload => payload.profileId,
      'wsl:Debian',
    ],
    [
      'agentEnvByProvider',
      {
        agentEnvByProvider: {
          ...DEFAULT_AGENT_SETTINGS.agentEnvByProvider,
          codex: [{ id: 'row', key: 'FROM_SETTINGS', value: 'yes', enabled: true }],
        },
      },
      payload => payload.env,
      { FROM_SETTINGS: 'yes' },
    ],
    [
      'agentExecutablePathOverrideByProvider',
      {
        agentExecutablePathOverrideByProvider: {
          ...DEFAULT_AGENT_SETTINGS.agentExecutablePathOverrideByProvider,
          codex: '/opt/codex',
        },
      },
      payload => payload.executablePathOverride,
      '/opt/codex',
    ],
  ]

  it.each(rows)(
    'launches with the %s of the settings at the call, on the command made before they changed',
    async (_name, patch, read, expected) => {
      const api = stubOpencoveApi()
      useAppStore.setState({
        agentSettings: {
          ...DEFAULT_AGENT_SETTINGS,
          agentFullAccess: false,
          codexReuseRunningAppServer: false,
          defaultTerminalProfileId: null,
        },
      })
      await mount()
      const before = seen[seen.length - 1]!
      const commands = commandsOf()

      await settingsWith(patch)
      // The change keeps the command object and the whole params value (guard).
      expect(seen[seen.length - 1]).toBe(before)
      expect(commandsOf()).toBe(commands)

      await act(async () => commands.terminal.reloadAgentSession('ag'))

      expect(api.launch).toHaveBeenCalledTimes(1)
      expect(read(api.launch.mock.calls[0]![0] as Record<string, unknown>)).toEqual(expected)
    },
  )

  it('launches with the font size of the settings at the call: another size, another geometry', async () => {
    const api = stubOpencoveApi()
    useAppStore.setState({ agentSettings: { ...DEFAULT_AGENT_SETTINGS, terminalFontSize: 13 } })
    await mount()
    const commands = commandsOf()
    await act(async () => commands.terminal.reloadAgentSession('ag'))

    await settingsWith({ terminalFontSize: 28 })
    expect(commandsOf()).toBe(commands)
    await act(async () => commands.terminal.reloadAgentSession('ag'))

    const [first, second] = api.launch.mock.calls.map(call => call[0] as { cols: number })
    expect(second!.cols).toBeLessThan(first!.cols)
  })
})

describe('the terminal display calibration is read when a launch starts', () => {
  // The identity spec pins that a flip keeps the command object; this pins that the object made
  // before the flip launches with the calibration of the call.
  it('launches with the geometry of the calibration at the call, on the command made before it', async () => {
    const api = stubOpencoveApi()
    await mount()
    const commands = commandsOf()
    await act(async () => commands.terminal.reloadAgentSession('ag'))
    await act(async () => controls.setCalibration(terminalCalibration(24)))
    expect(commandsOf()).toBe(commands)
    await act(async () => commands.terminal.reloadAgentSession('ag'))

    const [plain, calibrated] = api.launch.mock.calls.map(call => call[0] as { cols: number })
    expect(calibrated!.cols).toBeLessThan(plain!.cols)
  })
})

describe('a reload or a session switch that is waiting for the launch when the user switches workspace', () => {
  const summary = {
    sessionId: 'resume-next',
    provider: 'codex' as const,
    cwd: '/repo-next',
    title: null,
    preview: null,
    startedAt: null,
    updatedAt: null,
    source: 'codex-file' as const,
  }

  it('reloadAgentSession binds the new runtime in A and writes nothing in B', async () => {
    const api = stubOpencoveApi({ hold: true })
    await mount()
    const commandsOfA = commandsOf()
    let reloading!: Promise<void>
    act(() => {
      reloading = commandsOfA.terminal.reloadAgentSession('ag')
    })
    await vi.waitFor(() => expect(api.launch).toHaveBeenCalledTimes(1))
    await act(async () => controls.showWorkspace(B))
    const documentOfBBefore = readWorkspaceDocument(B)!

    await act(async () => {
      api.release()
      await reloading
    })

    expect(nodeOf(A, 'ag')?.data.sessionId).toBe('runtime-new')
    expect(readWorkspaceDocument(B)!.nodes).toBe(documentOfBBefore.nodes)
    expect(nodeOf(B, 'ag')?.data.sessionId).toBe('b-runtime')
  })

  it('switchAgentSession binds the chosen session in A, flushes once for it, and writes nothing in B', async () => {
    const api = stubOpencoveApi({ hold: true })
    const flushes = vi.fn()
    const unregister = registerWorkspaceDocumentPersistFlush(flushes)
    await mount()
    const commandsOfA = commandsOf()
    let switching!: Promise<void>
    act(() => {
      switching = commandsOfA.terminal.switchAgentSession('ag', summary)
    })
    await vi.waitFor(() => expect(api.launch).toHaveBeenCalledTimes(1))
    await act(async () => controls.showWorkspace(B))
    const documentOfBBefore = readWorkspaceDocument(B)!
    flushes.mockClear()

    await act(async () => {
      api.release()
      await switching
    })
    unregister()

    expect(nodeOf(A, 'ag')?.data.agent?.executionDirectory).toBe('/repo-next')
    expect(nodeOf(A, 'ag')?.data.sessionId).toBe('runtime-new')
    expect(readWorkspaceDocument(B)!.nodes).toBe(documentOfBBefore.nodes)
    expect(nodeOf(B, 'ag')?.data.agent?.executionDirectory).toBe('/repo-b')
    // The switch flushes once, at its end, whatever its last write did (not the flush of a write).
    expect(flushes).toHaveBeenCalledTimes(1)
  })
})

describe('each terminal command has the effect of the function it is named for', () => {
  it('recordCommandRun titles a terminal with the command that ran', async () => {
    await mount()

    act(() => commandsOf().terminal.recordCommandRun('t', 'npm test', 5))

    expect(nodeOf(A, 't')?.data.title).toBe('npm test')
    expect(nodeOf(A, 't')?.data.titlePinnedByUser).not.toBe(true)
  })

  it('renameTitle pins the title the user typed, and flushes once for it', async () => {
    const flushes = vi.fn()
    const unregister = registerWorkspaceDocumentPersistFlush(flushes)
    await mount()
    flushes.mockClear()

    act(() => commandsOf().terminal.renameTitle('t', ' My shell '))
    unregister()

    expect(nodeOf(A, 't')?.data.title).toBe('My shell')
    expect(nodeOf(A, 't')?.data.titlePinnedByUser).toBe(true)
    expect(flushes).toHaveBeenCalledTimes(1)
  })

  it('clearAgentOverlay clears the overlay of the invocation it names, and keeps a newer one', async () => {
    await mount()

    act(() => commandsOf().terminal.clearAgentOverlay('ov', 99))
    expect(nodeOf(A, 'ov')?.data.agentOverlay).toMatchObject({ startedAtMs: 100 })
    expect(nodeOf(A, 'ov')?.data.terminalAgentBinding).not.toBeNull()

    act(() => commandsOf().terminal.clearAgentOverlay('ov', 100))
    expect(nodeOf(A, 'ov')?.data.agentOverlay).toBeNull()
    expect(nodeOf(A, 'ov')?.data.terminalAgentBinding).toBeNull()
  })

  it('copyLastAgentMessage copies the last message of the agent to the clipboard', async () => {
    const readLastMessage = vi.fn(async () => ({ message: 'the last words' }))
    const writeText = vi.fn(async () => undefined)
    const api = window.opencoveApi as unknown as {
      agent: Record<string, unknown>
      clipboard?: Record<string, unknown>
    }
    api.agent.readLastMessage = readLastMessage
    api.clipboard = { writeText }
    await mount()

    await act(async () => commandsOf().terminal.copyLastAgentMessage('ag'))

    expect(readLastMessage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex' }))
    expect(writeText).toHaveBeenCalledWith('the last words')
  })

  it('listAgentSessions lists the sessions of the agent window, and of an agent that runs in a terminal', async () => {
    const listSessions = vi.fn(async () => ({ sessions: [{ sessionId: 'listed' }] }))
    ;(window.opencoveApi as unknown as { agent: Record<string, unknown> }).agent.listSessions =
      listSessions
    await mount()

    const ofAgent = await commandsOf().terminal.listAgentSessions('ag', 7)
    const ofOverlay = await commandsOf().terminal.listAgentSessions('ov')

    expect(listSessions).toHaveBeenNthCalledWith(1, {
      provider: 'codex',
      cwd: '/repo-a',
      limit: 7,
    })
    expect(listSessions).toHaveBeenNthCalledWith(2, {
      provider: 'codex',
      cwd: '/repo-ov',
      limit: 20,
    })
    expect(ofAgent).toEqual([{ sessionId: 'listed' }])
    expect(ofOverlay).toEqual([{ sessionId: 'listed' }])
  })

  it('reloadAgentSession re-executes the agent of a terminal in place, and launches the agent window', async () => {
    const reexecAgent = vi.fn(async (input: { sessionId: string }) => ({
      sessionId: input.sessionId,
      operationId: 'op',
      status: 'reexecuted' as const,
    }))
    const api = stubOpencoveApi()
    ;(window.opencoveApi as unknown as { pty: Record<string, unknown> }).pty.reexecAgent =
      reexecAgent
    await mount()

    await act(async () => commandsOf().terminal.reloadAgentSession('ov'))
    expect(reexecAgent).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'pty-ov' }))
    expect(api.launch).not.toHaveBeenCalled()

    await act(async () => commandsOf().terminal.reloadAgentSession('ag'))
    expect(api.launch).toHaveBeenCalledTimes(1)
    expect(reexecAgent).toHaveBeenCalledTimes(1)
  })

  it('switchAgentSession of an agent that runs in a terminal re-executes it with the chosen session, launching nothing', async () => {
    const reexecAgent = vi.fn(async (input: { sessionId: string }) => ({
      sessionId: input.sessionId,
      operationId: 'op',
      status: 'reexecuted' as const,
    }))
    const api = stubOpencoveApi()
    ;(window.opencoveApi as unknown as { pty: Record<string, unknown> }).pty.reexecAgent =
      reexecAgent
    await mount()

    await act(async () =>
      commandsOf().terminal.switchAgentSession('ov', {
        sessionId: 'resume-chosen',
        provider: 'codex',
        cwd: '/repo-ov',
        title: null,
        preview: null,
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: null,
        source: 'codex-file',
      }),
    )

    expect(reexecAgent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'pty-ov', resumeSessionId: 'resume-chosen' }),
    )
    expect(api.launch).not.toHaveBeenCalled()
    expect(nodeOf(A, 'ov')?.data.terminalAgentBinding?.resumeSessionId).toBe('resume-chosen')
  })
})
