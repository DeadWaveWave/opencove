import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../../src/contexts/settings/domain/agentEnv'
import { useWorkspaceCanvasAgentNodeLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import {
  agentNode,
  nodeOf,
  renderInTwoWorkspaces,
  stubOpencoveApi,
  taskNode,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
} from '../../support/agentRuntimeHarness'

// The agent lifecycle reads the committed nodes of the workspace whose render made its callbacks
// (#702, PR 10). A launch that the user interrupts by switching workspace finds its node after
// the await, binds it and keeps the PTY it started; before, it read the canvas ref, which shows
// the workspace on display, found no node and killed the PTY.
//
// The canvas store's own values keep the value of the first render, so only the document reader
// can make a callback follow the workspace shown.

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
const translation = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => translation }))

const agentEnvByProvider = DEFAULT_AGENT_ENV_BY_PROVIDER
const terminalDisplayMetrics = { fontSize: 13 }

// `stable` pins the reader's place in the dependency lists: the writer, the project id and the
// path then keep their value, so none of them can rebuild a callback and hide a missing reader.
function renderLifecycle(
  documents: Parameters<typeof renderInTwoWorkspaces>[1],
  { stable = false } = {},
) {
  return renderInTwoWorkspaces(({ workspaceId, nodeStore, stableSetNodes }) => {
    return useWorkspaceCanvasAgentNodeLifecycle({
      workspaceId: stable ? 'project' : workspaceId,
      workspacePath: stable ? '/repo' : `/tmp/${workspaceId}`,
      setNodes: stable ? stableSetNodes : nodeStore.setNodes,
      bumpAgentLaunchToken: nodeStore.bumpAgentLaunchToken,
      isAgentLaunchTokenCurrent: nodeStore.isAgentLaunchTokenCurrent,
      agentFullAccess: true,
      codexReuseRunningAppServer: false,
      defaultTerminalProfileId: null,
      terminalFontSize: 13,
      terminalDisplayMetrics,
      agentEnvByProvider,
    })
  }, documents)
}

interface PendingLaunch {
  resolve: () => void
  api: { launch: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }
}

function stubLaunch(sessionId: string): PendingLaunch {
  let resolve!: () => void
  const pending = new Promise<void>(onResolve => {
    resolve = onResolve
  })
  const launch = vi.fn(async () => {
    await pending
    return {
      sessionId,
      profileId: null,
      runtimeKind: 'posix',
      effectiveModel: 'gpt-5.2-codex',
      resumeSessionId: null,
    }
  })
  const kill = vi.fn(async () => undefined)
  stubOpencoveApi({
    agent: { launch },
    pty: { kill },
    workspace: { ensureDirectory: vi.fn(async () => undefined) },
  })
  return { resolve, api: { launch, kill } }
}

beforeEach(() => {
  firstRender.values.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the agent lifecycle in two workspaces', () => {
  it('binds the node of the workspace that started a launch when the user switches during the await, and keeps its PTY', async () => {
    const launched = stubLaunch('runtime-launched')
    const { view, showB } = renderLifecycle({
      a: { nodes: [agentNode('agent-a', { sessionId: '' })] },
      b: { nodes: [agentNode('agent-b')] },
    })

    let launch!: Promise<void>
    act(() => {
      launch = view.result.current.launchAgentInNode('agent-a', 'new')
    })
    await waitFor(() => expect(launched.api.launch).toHaveBeenCalledTimes(1))
    showB()
    await act(async () => {
      launched.resolve()
      await launch
    })

    expect(launched.api.kill).not.toHaveBeenCalled()
    expect(nodeOf(A, 'agent-a').data).toMatchObject({
      sessionId: 'runtime-launched',
      status: 'running',
    })
    expect(nodeOf(B, 'agent-b').data.sessionId).toBe('agent-b-runtime')
  })

  it('kills the PTY it started when the node left its workspace during the await', async () => {
    const launched = stubLaunch('runtime-orphan')
    const { view, showB } = renderLifecycle({
      a: { nodes: [agentNode('agent-a', { sessionId: '' })] },
      b: { nodes: [agentNode('agent-b')] },
    })

    let launch!: Promise<void>
    act(() => {
      launch = view.result.current.launchAgentInNode('agent-a', 'new')
    })
    await waitFor(() => expect(launched.api.launch).toHaveBeenCalledTimes(1))
    // The node leaves its workspace during the await, as a close would remove it.
    act(() => {
      replaceWorkspaceNodes(A, [])
    })
    showB()
    await act(async () => {
      launched.resolve()
      await launch
    })

    expect(launched.api.kill).toHaveBeenCalledWith({ sessionId: 'runtime-orphan' })
    expect(nodeOf(B, 'agent-b').data.sessionId).toBe('agent-b-runtime')
  })

  it('launches a node of the shown workspace after a switch', async () => {
    const launched = stubLaunch('runtime-b')
    launched.resolve()
    const { view, showB } = renderLifecycle(
      {
        a: { nodes: [agentNode('agent-a', { sessionId: '' })] },
        b: { nodes: [agentNode('agent-b', { sessionId: '' })] },
      },
      { stable: true },
    )
    showB()

    await act(async () => {
      await view.result.current.launchAgentInNode('agent-b', 'new')
    })

    expect(nodeOf(B, 'agent-b').data.sessionId).toBe('runtime-b')
    expect(nodeOf(A, 'agent-a').data.sessionId).toBe('')
    expect(launched.api.kill).not.toHaveBeenCalled()
  })

  it('launches a node of its own workspace while another is displayed', async () => {
    const launched = stubLaunch('runtime-a')
    launched.resolve()
    const { view } = renderLifecycle({
      a: { nodes: [agentNode('agent-a', { sessionId: '' })] },
      b: { nodes: [agentNode('agent-b')] },
    })
    act(() => useAppStore.setState({ activeWorkspaceId: B }))

    await act(async () => {
      await view.result.current.launchAgentInNode('agent-a', 'new')
    })

    expect(nodeOf(A, 'agent-a').data.sessionId).toBe('runtime-a')
    expect(launched.api.kill).not.toHaveBeenCalled()
  })

  it('reloads a node the store gained in the same call, in the shown workspace', async () => {
    const launched = stubLaunch('runtime-reloaded')
    launched.resolve()
    const { view, showB } = renderLifecycle({}, { stable: true })
    showB()

    await act(async () => {
      replaceWorkspaceNodes(B, [agentNode('agent-b', { sessionId: '' })])
      await view.result.current.reloadAgentNode('agent-b')
    })

    expect(launched.api.launch).toHaveBeenCalledTimes(1)
    expect(nodeOf(B, 'agent-b').data.sessionId).toBe('runtime-reloaded')
  })

  it('reloads a node of its own workspace while another is displayed', async () => {
    const launch = vi.fn(async () => ({
      sessionId: 'runtime-reloaded',
      profileId: null,
      runtimeKind: 'posix',
      effectiveModel: 'gpt-5.2-codex',
      resumeSessionId: null,
    }))
    stubOpencoveApi({
      agent: { launch },
      pty: { kill: vi.fn(async () => undefined) },
      workspace: { ensureDirectory: vi.fn(async () => undefined) },
    })
    const { view } = renderLifecycle({
      a: {
        nodes: [
          agentNode(
            'agent-a',
            { sessionId: '' },
            { resumeSessionId: null, resumeSessionIdVerified: false },
          ),
        ],
      },
      b: { nodes: [agentNode('agent-b')] },
    })
    act(() => useAppStore.setState({ activeWorkspaceId: B }))

    await act(async () => {
      await view.result.current.reloadAgentNode('agent-a')
    })

    expect(launch).toHaveBeenCalledTimes(1)
    expect(nodeOf(A, 'agent-a').data.sessionId).toBe('runtime-reloaded')
  })

  it('binds a managed Claude launch, titled by its task, in the workspace that started it after a switch', async () => {
    let releaseBinding!: () => void
    const bindingGate = new Promise<void>(resolve => {
      releaseBinding = resolve
    })
    let releaseLaunch!: () => void
    const launchGate = new Promise<void>(resolve => {
      releaseLaunch = resolve
    })
    const binding = {
      nodeId: 'agent-a',
      activationId: 'adopted',
      runtimeSessionId: 'new',
      tuple: { resumeSessionId: 'effective', resumeSessionIdVerified: true },
      nodeSeen: true,
      bindingRevision: 1,
      observedRevision: 1,
    }
    const launch = vi.fn(async () => {
      await launchGate
      return {
        sessionId: 'new',
        profileId: null,
        effectiveModel: null,
        resumeSessionId: 'effective',
        startedAt: '2026-11-11T00:00:00Z',
        managedClaudeLifecycle: { binding, commitRevision: 1 },
        executionContext: {
          workingDirectory: '/tmp/agent-a',
          endpoint: { endpointId: 'local' },
          mountId: null,
        },
      }
    })
    let bindingReads = 0
    const invoke = vi.fn(async (request: { id: string }) => {
      if (request.id === 'system.capabilities') {
        return { features: { managedClaudeResumeBindingDeliveryV1: true } }
      }
      if (request.id === 'node.get') {
        return { node: { data: { kind: 'agent', executionDirectory: '/tmp/agent-a' } } }
      }
      if (request.id === 'node.managedClaudeBinding') {
        bindingReads += 1
        if (bindingReads === 1) {
          await bindingGate
        }
        return {
          managedClaudeBinding: launch.mock.calls.length ? binding : null,
          retired: false,
          executionDirectory: null,
        }
      }
      if (request.id === 'mount.list') {
        return { mounts: [] }
      }
      throw new Error(`Unexpected request ${request.id}`)
    })
    const kill = vi.fn(async () => undefined)
    stubOpencoveApi({ controlSurface: { invoke }, agent: { launch }, pty: { kill } })
    const claude = agentNode(
      'agent-a',
      { sessionId: '' },
      {
        provider: 'claude-code',
        resumeSessionId: null,
        resumeSessionIdVerified: false,
        taskId: 'task-1',
      },
    )
    const { view, showB } = renderLifecycle({
      a: { nodes: [claude, taskNode('task-1', 'agent-a')] },
      b: { nodes: [agentNode('agent-b')] },
    })

    let launching!: Promise<void>
    act(() => {
      launching = view.result.current.launchAgentInNode('agent-a', 'new')
    })
    await waitFor(() => expect(bindingReads).toBe(1))
    showB()
    await act(async () => {
      releaseBinding()
      await waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
      releaseLaunch()
      await launching
    })

    expect(kill).not.toHaveBeenCalled()
    expect(nodeOf(A, 'agent-a').data.sessionId).toBe('new')
    expect(nodeOf(A, 'agent-a').data.title).toContain('Task')
    expect(nodeOf(B, 'agent-b').data.sessionId).toBe('agent-b-runtime')
  })
})
