import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  A,
  B,
  commandsOf,
  controls,
  documentOfA,
  installCanvasHarnessHooks,
  ipc,
  latest,
  mount,
  observe,
  onShowMessage,
  stubAgentLaunch,
} from '../../support/canvasNodeCommandsHarness'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import {
  commitCanvasDocument,
  readWorkspaceDocument,
  registerWorkspaceDocumentPersistFlush,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { resolveDefaultAgentWindowSize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { setDocumentNodes } from '../../support/documentNodes'
import { pixelNode } from './workspacePixelLayer.fixtures'

// S7 of #647, PR 6: the role family, called through the real canvas on the faithful React Flow mock
// (the harness is `tests/support/canvasNodeCommandsHarness.tsx`). What this spec pins:
//   - `role.run` reads the app's settings when a run starts, and a settings change keeps the
//     command object and the whole params value (Decision 2);
//   - a run that started in A and finishes after the switch to B writes A: its record, its status
//     and its error (Decision 4);
//   - `updateInput`, `updateProvider` and `run` do what the functions they are named for do.
// The closed-node rows for the three commands are in `canvasNodeCommands.closedNode.spec.tsx`.

installCanvasHarnessHooks()

const ROLE = {
  id: 'role-1',
  name: 'Reviewer',
  description: 'reviews',
  promptTemplate: 'Review: {{input}}',
  inputHint: '',
  outputFormat: 'plain text',
  createdAt: '2026-03-15T00:00:00.000Z',
  updatedAt: '2026-03-15T00:00:00.000Z',
}

function roleWindow(
  id: string,
  x: number,
  {
    input = 'look at this',
    selectedProvider = 'codex',
  }: { input?: string; selectedProvider?: 'codex' | 'opencode' | null } = {},
): Node<TerminalNodeData> {
  return {
    ...pixelNode({
      kind: 'role',
      sessionId: '',
      title: id,
      role: {
        roleId: ROLE.id,
        roleName: 'Stale name',
        roleDescription: '',
        promptTemplate: 'stale template',
        inputHint: '',
        outputFormat: '',
        input,
        selectedProvider,
        linkedAgentNodeId: null,
        runHistory: [],
        createdAt: null,
        updatedAt: null,
      },
    }),
    id,
    position: { x, y: 0 },
    initialWidth: 300,
    initialHeight: 200,
  }
}

const nodeOf = (workspaceId: string, nodeId: string) =>
  readWorkspaceDocument(workspaceId)?.nodes.find(node => node.id === nodeId)
const roleOf = (workspaceId: string, nodeId = 'r') => nodeOf(workspaceId, nodeId)?.data.role
const agentsOf = (workspaceId: string) =>
  readWorkspaceDocument(workspaceId)?.nodes.filter(node => node.data.kind === 'agent') ?? []

/** The launch these rows stub: the harness's, with the session id the rows assert. */
const stubLaunch = (options: { hold?: boolean; fail?: boolean } = {}) =>
  stubAgentLaunch({ ...options, sessionId: 'runtime-role' })

const settingsWith = (patch: Partial<AgentSettings>) =>
  act(() => {
    useAppStore.setState(state => ({ agentSettings: { ...state.agentSettings, ...patch } }))
  })

beforeEach(() => {
  ipc.invoke.mockReset()
  useAppStore.setState({
    agentSettings: {
      ...DEFAULT_AGENT_SETTINGS,
      projectRolesByWorkspaceId: { [A]: [ROLE], [B]: [ROLE] },
    },
  })
  // `r` in A has input 'in A', and the same id in B has another input, so a write that reached B
  // shows. `r-default` follows the default provider.
  setDocumentNodes(A, [
    ...documentOfA(),
    roleWindow('r', 2400, { input: 'in A' }),
    roleWindow('r-default', 3000, { selectedProvider: null }),
  ])
  setDocumentNodes(B, [roleWindow('r', 0, { input: 'in B' })])
})

describe('role.run reads the settings when the run starts', () => {
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
    [
      'the role definition of the project',
      {
        projectRolesByWorkspaceId: {
          [A]: [{ ...ROLE, promptTemplate: 'Edited after the render: {{input}}' }],
        },
      },
      payload => payload.prompt,
      expect.stringContaining('Edited after the render:'),
    ],
  ]

  it.each(rows)(
    'launches with the %s of the settings at the call, on the command made before they changed',
    async (_name, patch, read, expected) => {
      const launch = stubLaunch()
      await mount()
      const before = latest()
      const commands = commandsOf()

      await settingsWith(patch)
      // The change keeps the command object and the whole params value (guard).
      expect(latest().params).toBe(before.params)
      expect(commandsOf()).toBe(commands)
      expect(commandsOf().role).toBe(commands.role)

      await act(async () => commands.role.run('r'))

      expect(launch.payloads()).toHaveLength(1)
      expect(read(launch.payloads()[0]!)).toEqual(expected)
    },
  )

  it('launches with the default provider of the settings at the call, for a role that names none', async () => {
    const launch = stubLaunch()
    await mount()
    const commands = commandsOf()

    await settingsWith({ defaultProvider: 'opencode' })
    expect(commandsOf()).toBe(commands)
    await act(async () => commands.role.run('r-default'))

    expect(launch.payloads()[0]!.provider).toBe('opencode')
  })

  it('launches with the font size of the settings at the call: another size, another geometry', async () => {
    const launch = stubLaunch()
    useAppStore.setState(state => ({
      agentSettings: { ...state.agentSettings, terminalFontSize: 13 },
    }))
    await mount()
    const commands = commandsOf()
    await act(async () => commands.role.run('r'))

    await settingsWith({ terminalFontSize: 28 })
    expect(commandsOf()).toBe(commands)
    await act(async () => commands.role.run('r'))

    const [first, second] = launch.payloads().map(payload => payload.cols as number)
    expect(second).toBeLessThan(first!)
  })

  it('sizes the agent window it creates from the window size of the settings at the call', async () => {
    stubLaunch()
    await mount()
    const commands = commandsOf()
    await act(async () => commands.role.run('r'))
    const widthOfFirst = agentsOf(A)[0]!.data.width

    await settingsWith({ standardWindowSizeBucket: 'large' })
    expect(commandsOf()).toBe(commands)
    await act(async () => commands.role.run('r'))

    const widthOfSecond = agentsOf(A)[1]!.data.width
    expect(widthOfSecond).toBeGreaterThan(widthOfFirst)
  })
})

describe('a role run that is waiting for the launch when the user switches workspace', () => {
  it('records the run, the agent and the cleared error in A, and writes nothing in B', async () => {
    const launch = stubLaunch({ hold: true })
    await mount()
    const commandsOfA = commandsOf()
    let running!: Promise<void>
    act(() => {
      running = commandsOfA.role.run('r', 'typed in A')
    })
    await vi.waitFor(() => expect(launch.payloads()).toHaveLength(1))
    await observe(() => controls.showWorkspace(B))
    const documentOfBBefore = readWorkspaceDocument(B)!

    await act(async () => {
      launch.release()
      await running
    })

    const agents = agentsOf(A)
    expect(agents).toHaveLength(1)
    expect(agents[0]!.data.sessionId).toBe('runtime-role')
    expect(roleOf(A)).toMatchObject({
      input: 'typed in A',
      linkedAgentNodeId: agents[0]!.id,
      selectedProvider: 'codex',
      roleName: 'Reviewer',
      promptTemplate: 'Review: {{input}}',
    })
    expect(roleOf(A)!.runHistory).toHaveLength(1)
    expect(roleOf(A)!.runHistory[0]).toMatchObject({
      input: 'typed in A',
      agentNodeId: agents[0]!.id,
      sessionId: 'runtime-role',
    })
    expect(nodeOf(A, 'r')!.data.lastError).toBeNull()
    expect(nodeOf(A, 'r')!.data.title).toBe('Reviewer')
    // B: the same object, and its own `r` as it was.
    expect(readWorkspaceDocument(B)!.nodes).toBe(documentOfBBefore.nodes)
    expect(roleOf(B)!.input).toBe('in B')
    expect(roleOf(B)!.runHistory).toEqual([])
  })

  it('writes the error of a refused launch to the role of A, shows it, and writes nothing in B', async () => {
    const launch = stubLaunch({ hold: true, fail: true })
    onShowMessage.mockClear()
    await mount()
    const commandsOfA = commandsOf()
    let running!: Promise<void>
    act(() => {
      running = commandsOfA.role.run('r')
    })
    await vi.waitFor(() => expect(launch.payloads()).toHaveLength(1))
    await observe(() => controls.showWorkspace(B))
    const documentOfBBefore = readWorkspaceDocument(B)!

    await act(async () => {
      launch.release()
      await running
    })

    expect(nodeOf(A, 'r')!.data.lastError).toEqual(expect.stringContaining('launch refused'))
    expect(roleOf(A)!.runHistory).toEqual([])
    expect(agentsOf(A)).toEqual([])
    expect(onShowMessage).toHaveBeenCalledWith(expect.stringContaining('launch refused'), 'error')
    expect(readWorkspaceDocument(B)!.nodes).toBe(documentOfBBefore.nodes)
    expect(nodeOf(B, 'r')!.data.lastError).toBeNull()
  })
})

describe('role.run reads the settings once, when the run starts', () => {
  it('sizes the agent window from the bucket its launch geometry used, not one changed during the launch', async () => {
    const launch = stubLaunch({ hold: true })
    await mount()
    let running!: Promise<void>
    act(() => {
      running = commandsOf().role.run('r')
    })
    await vi.waitFor(() => expect(launch.payloads()).toHaveLength(1))
    await settingsWith({ standardWindowSizeBucket: 'large' })

    await act(async () => {
      launch.release()
      await running
    })

    const regular = resolveDefaultAgentWindowSize('regular', 'codex')
    expect(agentsOf(A)).toHaveLength(1)
    expect({ width: agentsOf(A)[0]!.data.width, height: agentsOf(A)[0]!.data.height }).toEqual(
      regular,
    )
  })
})

describe('a role window that is closed while its run waits for the launch', () => {
  // The launch that completes still creates its agent window (as before): one write, flushed by
  // the creator. Nothing else is written, notified or flushed for the window that is gone.
  it.each([
    ['succeeds', false, 1, 1],
    ['is refused', true, 0, 0],
  ] as const)(
    'writes nothing about the window when the launch %s',
    async (_name, fail, writes, flushCount) => {
      const launch = stubLaunch({ hold: true, fail })
      await mount()
      let running!: Promise<void>
      act(() => {
        running = commandsOf().role.run('r')
      })
      await vi.waitFor(() => expect(launch.payloads()).toHaveLength(1))
      act(() => {
        commitCanvasDocument(A, document => ({
          ...document,
          nodes: document.nodes.filter(node => node.id !== 'r'),
        }))
      })
      const notifications = vi.fn()
      const flushes = vi.fn()
      const unsubscribe = useAppStore.subscribe(notifications)
      const unregister = registerWorkspaceDocumentPersistFlush(flushes)

      await act(async () => {
        launch.release()
        await running
      })
      unsubscribe()
      unregister()

      expect(notifications).toHaveBeenCalledTimes(writes)
      expect(flushes).toHaveBeenCalledTimes(flushCount)
      expect(nodeOf(A, 'r')).toBeUndefined()
      expect(agentsOf(A)).toHaveLength(fail ? 0 : 1)
    },
  )
})

describe('a role command of workspace A that runs after the switch to B writes A (Decision 4)', () => {
  it('updateInput and updateProvider write the role of the workspace that made them', async () => {
    await mount()
    const commandsOfA = commandsOf()
    await observe(() => controls.showWorkspace(B))

    act(() => {
      commandsOfA.role.updateInput('r', 'late input')
      commandsOfA.role.updateProvider('r', 'opencode')
    })

    expect(roleOf(A)).toMatchObject({ input: 'late input', selectedProvider: 'opencode' })
    expect(roleOf(B)).toMatchObject({ input: 'in B', selectedProvider: 'codex' })
  })

  it('a command of B writes B after the switch, not A', async () => {
    await mount()
    await observe(() => controls.showWorkspace(B))

    act(() => commandsOf().role.updateInput('r', 'in B now'))

    expect(roleOf(B)!.input).toBe('in B now')
    expect(roleOf(A)!.input).toBe('in A')
  })
})

describe('each role command has the effect of the function it is named for', () => {
  it('updateInput saves the input of the role window, and flushes once for the change only', async () => {
    const flushes = vi.fn()
    const unregister = registerWorkspaceDocumentPersistFlush(flushes)
    await mount()
    flushes.mockClear()

    act(() => commandsOf().role.updateInput('r', 'saved'))
    expect(flushes).toHaveBeenCalledTimes(1)
    act(() => commandsOf().role.updateInput('r', 'saved'))
    unregister()

    expect(roleOf(A)!.input).toBe('saved')
    // The same input again changes nothing, so it persists nothing.
    expect(flushes).toHaveBeenCalledTimes(1)
  })

  it('updateProvider selects the provider of the role window, and flushes once for the change only', async () => {
    const flushes = vi.fn()
    const unregister = registerWorkspaceDocumentPersistFlush(flushes)
    await mount()
    flushes.mockClear()

    act(() => commandsOf().role.updateProvider('r', 'opencode'))
    act(() => commandsOf().role.updateProvider('r', 'opencode'))
    unregister()

    expect(roleOf(A)!.selectedProvider).toBe('opencode')
    expect(flushes).toHaveBeenCalledTimes(1)
  })

  it('run with an input override saves it first, then launches with it', async () => {
    const launch = stubLaunch()
    await mount()

    await act(async () => commandsOf().role.run('r', 'override'))

    expect(roleOf(A)!.input).toBe('override')
    expect(launch.payloads()[0]!.prompt).toEqual(expect.stringContaining('override'))
  })

  it('run of a role whose definition the project no longer holds writes the error and launches nothing', async () => {
    const launch = stubLaunch()
    await settingsWith({ projectRolesByWorkspaceId: {} })
    await mount()

    await act(async () => commandsOf().role.run('r'))

    expect(launch.payloads()).toEqual([])
    expect(nodeOf(A, 'r')!.data.lastError).toEqual(expect.any(String))
    expect(nodeOf(A, 'r')!.data.lastError).not.toBe('')
  })
})
