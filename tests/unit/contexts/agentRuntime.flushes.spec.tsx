import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSessionSummary,
  TerminalSessionMetadataEvent,
} from '../../../src/shared/contracts/dto'
import {
  createPtyEventHub,
  type PtyEventHub,
} from '../../../src/app/renderer/shell/utils/ptyEventHub'
import { useAgentNodeSessionSwitch } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeSessionSwitch'
import { useTerminalAgentSessionActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTerminalAgentSessionActions'
import { useWorkspaceCanvasPtyTaskCompletion } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'

import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  agentNode,
  sized,
  nodeOf,
  renderInTwoWorkspaces,
  stubOpencoveApi,
  taskNode,
  WORKSPACE_A as A,
} from '../../support/agentRuntimeHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'
import { setDocumentNodes } from '../../support/documentNodes'

// The persistence flushes of the session switch, the terminal agent session actions and the PTY
// task completion (#702, PR 10): each is requested once, after the write it follows, and as often
// as before. A flush is counted with the number of store writes that came before it and the
// document it saw, so one that is dropped, doubled or requested before its write fails.

const shared = vi.hoisted(() => ({ hub: null as PtyEventHub | null }))
vi.mock('../../../src/app/renderer/shell/utils/ptyEventHub', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/app/renderer/shell/utils/ptyEventHub')>()),
  getPtyEventHub: () => shared.hub!,
}))
const translation = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => translation }))

let emitMetadata!: (event: TerminalSessionMetadataEvent) => void

beforeEach(() => {
  shared.hub = createPtyEventHub({
    onData: () => () => undefined,
    onExit: () => () => undefined,
    onState: () => () => undefined,
    onMetadata: listener => {
      emitMetadata = listener
      return () => undefined
    },
  })
  shared.hub.onMetadata(() => undefined)
})

afterEach(() => {
  shared.hub?.dispose()
  shared.hub = null
  vi.unstubAllGlobals()
})

const summary = (sessionId: string): AgentSessionSummary => ({
  sessionId,
  provider: 'codex',
  cwd: '/dir',
  title: 'Review persistence',
  preview: null,
  startedAt: null,
  updatedAt: null,
  source: 'codex-file',
})

describe('the session switch flush', () => {
  const linked = (resumeSessionId: string, taskId: string | null = 'task-1') =>
    agentNode('agent-1', {}, { taskId, resumeSessionId, executionDirectory: '/dir' })
  const receiptFor = (resumeSessionId: string) =>
    ({ binding: { tuple: { resumeSessionId } } }) as never

  function renderSwitch(relaunch: () => Promise<unknown>, nodes: Node<TerminalNodeData>[]) {
    const rendered = renderInTwoWorkspaces(
      () =>
        useAgentNodeSessionSwitch({
          relaunchAgentNode: relaunch as never,
        }),
      { a: { nodes } },
    )
    rendered.harness.notifications.mockClear()
    return rendered
  }

  it('flushes once, on the write that records the old session on its task', async () => {
    const { view, harness, flushes } = renderSwitch(
      async () => receiptFor('resume-new'),
      [linked('resume-old'), taskNode('task-1', 'agent-1')],
    )

    await act(async () => {
      await view.result.current('agent-1', summary('resume-new'))
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    const task = flushes[0].document.nodes.find(node => node.id === 'task-1')
    expect(task?.data.task?.agentSessions).toHaveLength(1)
  })

  it.each([
    {
      name: 'the relaunch did not commit the new session',
      receipt: () => receiptFor('another-session'),
      node: linked('resume-old'),
    },
    {
      name: 'the agent is not linked to a task',
      receipt: () => receiptFor('resume-new'),
      node: linked('resume-old', null),
    },
  ])('flushes once without a write when $name', async ({ receipt, node }) => {
    const { view, harness, flushes } = renderSwitch(
      async () => receipt(),
      [node, taskNode('task-1', 'agent-1')],
    )

    await act(async () => {
      await view.result.current('agent-1', summary('resume-new'))
    })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(0)
  })

  // The switch flushes at its end, explicitly: the history write finds no task and changes nothing.
  it('flushes once, after the relaunch wrote, when the task node was deleted during it', async () => {
    const { view, harness, flushes } = renderSwitch(async () => {
      setDocumentNodes(A, [linked('resume-new')])
      return receiptFor('resume-new')
    }, [linked('resume-old'), taskNode('task-1', 'agent-1')])

    await act(async () => {
      await view.result.current('agent-1', summary('resume-new'))
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes.map(node => node.id)).toEqual(['agent-1'])
  })

  it('does not flush when the node is not an agent of the store, or is already on the session', async () => {
    const { view, flushes } = renderSwitch(
      async () => receiptFor('resume-new'),
      [linked('resume-new')],
    )

    await act(async () => {
      await view.result.current('agent-1', summary('resume-new'))
      await view.result.current('missing', summary('resume-new'))
    })

    expect(flushes).toHaveLength(0)
  })
})

describe('the terminal session action flush', () => {
  const overlayNode = (sessionId: string): Node<TerminalNodeData> =>
    sized({
      ...pixelNode({
        kind: 'terminal',
        sessionId,
        executionDirectory: '/tmp/terminal-1',
        terminalAgentBinding: {
          provider: 'codex',
          resumeSessionId: 'resume-current',
          resumeSessionIdVerified: true,
        },
        agentOverlay: {
          provider: 'codex',
          status: 'standby',
          startedAtMs: Date.parse('2026-08-12T00:00:00.000Z'),
        },
      }),
      id: 'terminal-1',
    })

  function renderActions(reexecAgent: (input: { sessionId: string }) => Promise<unknown>) {
    stubOpencoveApi({ pty: { reexecAgent }, agent: { listSessions: vi.fn() } })
    const rendered = renderInTwoWorkspaces(() => useTerminalAgentSessionActions({}), {
      a: { nodes: [overlayNode('pty-1')] },
    })
    rendered.harness.notifications.mockClear()
    return rendered
  }

  const reexecuted = async (input: { sessionId: string }) => ({
    sessionId: input.sessionId,
    operationId: 'operation-1',
    status: 'reexecuted' as const,
  })

  it('flushes once, after the write that re-activates the overlay', async () => {
    const { view, harness, flushes } = renderActions(reexecuted)

    await act(async () => {
      await view.result.current.switchOverlayAgentSession('terminal-1', summary('resume-selected'))
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes[0].data.terminalAgentBinding?.resumeSessionId).toBe(
      'resume-selected',
    )
  })

  it('does not flush when the write finds the runtime already replaced', async () => {
    const { view, harness, flushes } = renderActions(async input => {
      // The terminal's runtime is replaced while the Worker re-executes.
      setDocumentNodes(A, [overlayNode('pty-replacement')])
      return await reexecuted(input)
    })
    harness.notifications.mockClear()

    await act(async () => {
      await view.result.current.reloadOverlayAgent('terminal-1')
    })

    expect(nodeOf(A, 'terminal-1').data.sessionId).toBe('pty-replacement')
    // The replacement is the only store write: the re-activation recipe returns its input.
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(0)
  })

  it('writes nothing and does not flush when the node was closed during the re-execution', async () => {
    const { view, harness, flushes } = renderActions(async input => {
      setDocumentNodes(A, [])
      return await reexecuted(input)
    })
    harness.notifications.mockClear()

    await act(async () => {
      await view.result.current.reloadOverlayAgent('terminal-1')
    })

    // The closing is the only store write.
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(0)
  })

  it('does not flush when the Worker does not re-execute', async () => {
    const { view, flushes } = renderActions(async input => ({
      sessionId: input.sessionId,
      operationId: 'operation-1',
      status: 'drop_back_timeout' as const,
    }))

    await act(async () => {
      await view.result.current.reloadOverlayAgent('terminal-1')
    })

    expect(flushes).toHaveLength(0)
  })
})

describe('the PTY task completion flush', () => {
  function renderCompletion(
    node: Node<TerminalNodeData>,
    listAgentSessions?: (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>,
  ) {
    const rendered = renderInTwoWorkspaces(
      ({ canvasState }) => {
        useWorkspaceCanvasPtyTaskCompletion({
          nodes: canvasState.flowNodes,
          listAgentSessions,
        })
      },
      { a: { nodes: [node] } },
    )
    rendered.harness.notifications.mockClear()
    return rendered
  }

  const unbound = () =>
    agentNode('agent-1', {}, { resumeSessionId: null, resumeSessionIdVerified: false })

  it('flushes once, after the write that binds the session of a metadata event', async () => {
    const { harness, flushes } = renderCompletion(unbound())

    await act(async () => {
      emitMetadata({ sessionId: 'agent-1-runtime', resumeSessionId: 'resume-new' })
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes[0].data.agent?.resumeSessionId).toBe('resume-new')
  })

  it('does not flush for an event that changes nothing', async () => {
    const { flushes } = renderCompletion(agentNode('agent-1'))

    await act(async () => {
      emitMetadata({ sessionId: 'agent-1-runtime', resumeSessionId: 'agent-1-resume' })
    })

    expect(flushes).toHaveLength(0)
  })

  it('flushes once, after the write of the session title', async () => {
    const query = vi.fn(async () => [{ ...summary('agent-1-resume'), title: 'Review persistence' }])
    const { harness, flushes } = renderCompletion(agentNode('agent-1'), query)

    await act(async () => {
      emitMetadata({ sessionId: 'agent-1-runtime', resumeSessionId: 'agent-1-resume' })
    })

    expect(nodeOf(A, 'agent-1').data.title).toBe('codex · Review persistence')
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes[0].data.title).toBe('codex · Review persistence')
  })

  it('does not flush when the session title is already the node title', async () => {
    const query = vi.fn(async () => [
      {
        sessionId: 'agent-1-resume',
        provider: 'codex' as const,
        cwd: '/dir',
        title: 'Review persistence',
        preview: null,
        startedAt: null,
        updatedAt: null,
        source: 'codex-file' as const,
      },
    ])
    const { flushes, harness } = renderInTwoWorkspaces(
      ({ canvasState }) => {
        useWorkspaceCanvasPtyTaskCompletion({
          nodes: canvasState.flowNodes,
          listAgentSessions: query,
        })
      },
      { a: { nodes: [agentNode('agent-1', { title: 'codex · Review persistence' })] } },
    )
    harness.notifications.mockClear()

    await act(async () => {
      emitMetadata({ sessionId: 'agent-1-runtime', resumeSessionId: 'agent-1-resume' })
    })

    expect(query).toHaveBeenCalledWith('agent-1', 20)
    expect(nodeOf(A, 'agent-1').data.title).toBe('codex · Review persistence')
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveLength(0)
  })
})
