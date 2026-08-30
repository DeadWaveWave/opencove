import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalAgentReexecStatus } from '../../../src/shared/contracts/dto'
import { useTerminalAgentSessionActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTerminalAgentSessionActions'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

function createOverlayNode(): Node<TerminalNodeData> {
  return {
    id: 'terminal-1',
    type: 'terminalNode',
    position: { x: 1, y: 2 },
    data: {
      sessionId: 'pty-session-1',
      title: 'Terminal',
      width: 520,
      height: 400,
      kind: 'terminal',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: 'scrollback-before-reexec',
      executionDirectory: '/tmp/overlay-cwd',
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
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    },
  }
}

function createHarness(options: {
  status?: TerminalAgentReexecStatus
  authenticatedActivity?: boolean
}) {
  const initialNode = createOverlayNode()
  if (options.authenticatedActivity && initialNode.data.agentOverlay) {
    initialNode.data.agentOverlay.activity = {
      invocationId: 'invocation-1',
      generation: 1,
      phase: 'active',
      observedAtMs: 100,
      sourceRevision: 1,
      revision: 1,
    }
  }
  const nodesRef = { current: [initialNode] }
  const setNodes = vi.fn(
    (updater: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => {
      nodesRef.current = updater(nodesRef.current)
    },
  )
  const reexecAgent = vi.fn(async (input: { sessionId: string }) => ({
    sessionId: input.sessionId,
    operationId: 'operation-1',
    status: options.status ?? ('reexecuted' as const),
  }))
  const listSessions = vi.fn(async () => ({ provider: 'codex', cwd: '', sessions: [] }))
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      pty: { reexecAgent },
      agent: { listSessions },
    },
  })
  const onShowMessage = vi.fn()
  const onRequestPersistFlush = vi.fn()
  const hook = renderHook(() =>
    useTerminalAgentSessionActions({
      nodesRef,
      setNodes,
      onShowMessage,
      onRequestPersistFlush,
    }),
  )

  return {
    ...hook,
    listSessions,
    nodesRef,
    onRequestPersistFlush,
    onShowMessage,
    reexecAgent,
  }
}

describe('terminal agent overlay session actions', () => {
  it('reloads through the Worker operation and preserves node scrollback', async () => {
    const harness = createHarness({})

    await act(async () => {
      await harness.result.current.reloadOverlayAgent('terminal-1')
    })

    expect(harness.reexecAgent).toHaveBeenCalledWith({
      sessionId: 'pty-session-1',
      provider: 'codex',
      resumeSessionId: 'resume-current',
      expectedActivity: null,
    })
    expect(harness.nodesRef.current[0]).toMatchObject({
      id: 'terminal-1',
      data: {
        kind: 'terminal',
        sessionId: 'pty-session-1',
        scrollback: 'scrollback-before-reexec',
        terminalAgentBinding: {
          provider: 'codex',
          resumeSessionId: 'resume-current',
          resumeSessionIdVerified: true,
        },
        agentOverlay: { provider: 'codex', status: 'standby' },
      },
    })
    expect(harness.onRequestPersistFlush).toHaveBeenCalledTimes(1)
  })

  it('lists sessions using overlay binding provider and terminal execution directory', async () => {
    const harness = createHarness({})

    await act(async () => {
      await harness.result.current.listOverlayAgentSessions('terminal-1', 7)
    })

    expect(harness.listSessions).toHaveBeenCalledWith({
      provider: 'codex',
      cwd: '/tmp/overlay-cwd',
      limit: 7,
    })
  })

  it('sends the authenticated invocation fence without discarding the durable binding', async () => {
    const harness = createHarness({ authenticatedActivity: true })

    await act(async () => {
      await harness.result.current.reloadOverlayAgent('terminal-1')
    })

    expect(harness.reexecAgent).toHaveBeenCalledWith({
      sessionId: 'pty-session-1',
      provider: 'codex',
      resumeSessionId: 'resume-current',
      expectedActivity: {
        provider: 'codex',
        invocationId: 'invocation-1',
        generation: 1,
        phase: 'active',
        observedAtMs: 100,
        sourceRevision: 1,
        revision: 1,
      },
    })
    expect(harness.nodesRef.current[0]?.data.terminalAgentBinding).toMatchObject({
      resumeSessionId: 'resume-current',
      resumeSessionIdVerified: true,
    })
  })

  it('switches to a selected session only after the Worker accepts re-exec', async () => {
    const harness = createHarness({})

    await act(async () => {
      await harness.result.current.switchOverlayAgentSession('terminal-1', {
        provider: 'codex',
        sessionId: 'resume-selected',
        cwd: '/tmp/selected-session-cwd',
        title: 'Selected session',
        startedAt: '2026-08-11T09:30:00.000Z',
        updatedAt: '2026-08-12T01:00:00.000Z',
        source: 'codex-file',
      })
    })

    expect(harness.reexecAgent).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSessionId: 'resume-selected' }),
    )
    expect(harness.nodesRef.current[0]).toMatchObject({
      data: {
        terminalAgentBinding: {
          provider: 'codex',
          resumeSessionId: 'resume-selected',
          resumeSessionIdVerified: true,
        },
        agentOverlay: {
          provider: 'codex',
          status: 'standby',
          startedAtMs: Date.parse('2026-08-11T09:30:00.000Z'),
        },
      },
    })
  })

  it('does not mutate the overlay and reports an in-app error when drop-back times out', async () => {
    const harness = createHarness({ status: 'drop_back_timeout' })

    await act(async () => {
      await harness.result.current.reloadOverlayAgent('terminal-1')
    })

    expect(harness.onShowMessage).toHaveBeenCalledWith(
      'The agent did not return to the terminal prompt, so no command was entered.',
      'error',
    )
    expect(harness.nodesRef.current[0]?.data.agentOverlay?.provider).toBe('codex')
    expect(harness.onRequestPersistFlush).not.toHaveBeenCalled()
  })
})
