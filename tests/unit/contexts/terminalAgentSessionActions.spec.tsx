import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { useTerminalAgentSessionActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTerminalAgentSessionActions'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { clearTerminalAgentOverlay } from '../../../src/contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'

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

function createHarness(options: { dropBackOnInterrupt: boolean }) {
  const nodesRef = { current: [createOverlayNode()] }
  const setNodes = vi.fn(
    (updater: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => {
      nodesRef.current = updater(nodesRef.current)
    },
  )
  const write = vi.fn(async ({ data }: { data: string }) => {
    if (data === '\u0003' && options.dropBackOnInterrupt) {
      nodesRef.current = nodesRef.current.map(clearTerminalAgentOverlay)
    }
  })
  const listSessions = vi.fn(async () => ({ provider: 'codex', cwd: '', sessions: [] }))
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      pty: { write },
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

  return { ...hook, listSessions, nodesRef, onRequestPersistFlush, onShowMessage, write }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('terminal agent overlay session actions', () => {
  it('reloads a verified session inside the same PTY and preserves node scrollback', async () => {
    const harness = createHarness({ dropBackOnInterrupt: true })

    await act(async () => {
      await harness.result.current.reloadOverlayAgent('terminal-1')
    })

    expect(harness.write).toHaveBeenNthCalledWith(1, {
      sessionId: 'pty-session-1',
      data: '\u0003',
    })
    expect(harness.write).toHaveBeenNthCalledWith(2, {
      sessionId: 'pty-session-1',
      data: '\u0015codex resume resume-current\r',
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
        agentOverlay: { provider: 'codex', status: 'running' },
      },
    })
    expect(harness.onRequestPersistFlush).toHaveBeenCalledTimes(1)
  })

  it('lists sessions using overlay binding provider and terminal execution directory', async () => {
    const harness = createHarness({ dropBackOnInterrupt: true })

    await act(async () => {
      await harness.result.current.listOverlayAgentSessions('terminal-1', 7)
    })

    expect(harness.listSessions).toHaveBeenCalledWith({
      provider: 'codex',
      cwd: '/tmp/overlay-cwd',
      limit: 7,
    })
  })

  it('switches to a selected session inside the same PTY and updates the binding identity', async () => {
    const harness = createHarness({ dropBackOnInterrupt: true })

    await act(async () => {
      await harness.result.current.switchOverlayAgentSession('terminal-1', {
        provider: 'codex',
        sessionId: 'resume-selected',
        cwd: '/tmp/selected-session-cwd',
        title: 'Selected session',
        startedAt: '2026-08-11T09:30:00.000Z',
        updatedAt: '2026-08-12T01:00:00.000Z',
      })
    })

    expect(harness.write).toHaveBeenNthCalledWith(1, {
      sessionId: 'pty-session-1',
      data: '\u0003',
    })
    expect(harness.write).toHaveBeenNthCalledWith(2, {
      sessionId: 'pty-session-1',
      data: '\u0015codex resume resume-selected\r',
    })
    expect(harness.nodesRef.current[0]).toMatchObject({
      id: 'terminal-1',
      data: {
        kind: 'terminal',
        sessionId: 'pty-session-1',
        scrollback: 'scrollback-before-reexec',
        terminalAgentBinding: {
          provider: 'codex',
          resumeSessionId: 'resume-selected',
          resumeSessionIdVerified: true,
        },
        agentOverlay: {
          provider: 'codex',
          status: 'running',
          startedAtMs: Date.parse('2026-08-11T09:30:00.000Z'),
        },
      },
    })
  })

  it('does not inject a command and reports an in-app error when drop-back times out', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ dropBackOnInterrupt: false })

    const reload = act(async () => {
      await harness.result.current.reloadOverlayAgent('terminal-1')
    })
    await vi.advanceTimersByTimeAsync(3_100)
    await reload

    expect(harness.write).toHaveBeenCalledTimes(1)
    expect(harness.onShowMessage).toHaveBeenCalledWith(
      'The agent did not return to the terminal prompt, so no command was entered.',
      'error',
    )
    expect(harness.nodesRef.current[0]?.data.agentOverlay?.provider).toBe('codex')
  })
})
