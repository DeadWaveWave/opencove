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

function renderLifecycle(documents: Parameters<typeof renderInTwoWorkspaces>[1]) {
  return renderInTwoWorkspaces(({ workspaceId, nodeStore }) => {
    return useWorkspaceCanvasAgentNodeLifecycle({
      workspaceId,
      workspacePath: `/tmp/${workspaceId}`,
      setNodes: nodeStore.setNodes,
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
    const { view, showB } = renderLifecycle({
      a: { nodes: [agentNode('agent-a', { sessionId: '' })] },
      b: { nodes: [agentNode('agent-b', { sessionId: '' })] },
    })
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
    const { view, showB } = renderLifecycle({})
    showB()

    await act(async () => {
      replaceWorkspaceNodes(B, [agentNode('agent-b', { sessionId: '' })])
      await view.result.current.reloadAgentNode('agent-b')
    })

    expect(launched.api.launch).toHaveBeenCalledTimes(1)
    expect(nodeOf(B, 'agent-b').data.sessionId).toBe('runtime-reloaded')
  })
})
