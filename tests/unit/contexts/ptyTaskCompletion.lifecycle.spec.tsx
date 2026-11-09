import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  AgentSessionSummary,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '@shared/contracts/dto'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { createPtyEventHub, type PtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import { useWorkspaceCanvasPtyTaskCompletion } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'

const shared = vi.hoisted(() => ({ hub: null as PtyEventHub | null }))
vi.mock('@app/renderer/shell/utils/ptyEventHub', async importOriginal => ({
  ...(await importOriginal<typeof import('@app/renderer/shell/utils/ptyEventHub')>()),
  getPtyEventHub: () => shared.hub!,
}))

function setup() {
  let emitMetadata!: (event: TerminalSessionMetadataEvent) => void
  let emitState!: (event: TerminalSessionStateEvent) => void
  shared.hub = createPtyEventHub({
    onData: () => () => undefined,
    onExit: () => () => undefined,
    onState: listener => {
      emitState = listener
      return () => undefined
    },
    onMetadata: listener => {
      emitMetadata = listener
      return () => undefined
    },
  })
  shared.hub.onMetadata(() => undefined)
  emitMetadata({ sessionId: 'runtime-1', resumeSessionId: 'resume-1' })
  const nodesRef = {
    current: [
      {
        id: 'agent-1',
        position: { x: 0, y: 0 },
        data: {
          sessionId: 'runtime-1',
          kind: 'agent',
          title: 'codex · default',
          agent: {
            provider: 'codex',
            launchMode: 'new',
            taskId: null,
            resumeSessionId: 'resume-1',
            resumeSessionIdVerified: true,
          },
        },
      } as Node<TerminalNodeData>,
    ],
  }
  let resolve!: (value: AgentSessionSummary[]) => void
  const pending = new Promise<AgentSessionSummary[]>(onResolve => {
    resolve = onResolve
  })
  const query = vi.fn(() => pending)
  const update = vi.fn((updater: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => {
    nodesRef.current = updater(nodesRef.current)
  })
  const flush = vi.fn()
  const summary: AgentSessionSummary = {
    sessionId: 'resume-1',
    provider: 'codex',
    cwd: '/project',
    title: 'Review persistence',
    preview: null,
    startedAt: null,
    updatedAt: null,
    source: 'codex-file',
  }
  return {
    nodesRef,
    query,
    update,
    flush,
    resolve,
    summary,
    emitState: (event: TerminalSessionStateEvent) => emitState(event),
  }
}

describe('PTY title subscription lifetime', () => {
  afterEach(() => {
    cleanup()
    shared.hub?.dispose()
    shared.hub = null
  })

  it('keeps one title request through callback changes and uses the latest commit callbacks', async () => {
    const state = setup()
    const { rerender } = renderHook(useWorkspaceCanvasPtyTaskCompletion, {
      initialProps: {
        nodesRef: state.nodesRef,
        nodes: state.nodesRef.current,
        listAgentSessions: state.query,
        setNodes: state.update,
        onRequestPersistFlush: state.flush,
      },
    })
    const latestUpdate = vi.fn(state.update)
    const latestFlush = vi.fn()
    for (let index = 0; index < 10; index++) {
      rerender({
        nodesRef: state.nodesRef,
        nodes: [...state.nodesRef.current],
        listAgentSessions: vi.fn(state.query),
        setNodes: latestUpdate,
        onRequestPersistFlush: latestFlush,
      })
    }
    const requests = state.query.mock.calls.length
    latestUpdate.mockClear()
    state.flush.mockClear()
    await act(async () => state.resolve([state.summary]))
    expect(requests).toBe(1)
    expect(state.nodesRef.current[0].data.title).toBe('codex · Review persistence')
    expect(latestUpdate).toHaveBeenCalled()
    expect(latestFlush).toHaveBeenCalledTimes(1)
    expect(state.flush).not.toHaveBeenCalled()
  })

  it.each(['unmount', 'session switch'] as const)('discards the result after %s', async action => {
    const state = setup()
    const { unmount } = renderHook(() =>
      useWorkspaceCanvasPtyTaskCompletion({
        nodesRef: state.nodesRef,
        listAgentSessions: state.query,
        setNodes: state.update,
        onRequestPersistFlush: state.flush,
      }),
    )
    if (action === 'unmount') {
      unmount()
    } else {
      state.nodesRef.current[0].data.sessionId = 'replacement-runtime'
    }
    state.update.mockClear()
    state.flush.mockClear()
    await act(async () => state.resolve([state.summary]))
    expect(state.update).not.toHaveBeenCalled()
    expect(state.flush).not.toHaveBeenCalled()
  })

  it('starts a fresh subscription when returning to a workspace', async () => {
    const state = setup()
    const props = {
      nodesRef: state.nodesRef,
      listAgentSessions: state.query,
      setNodes: state.update,
      onRequestPersistFlush: state.flush,
    }
    const { rerender } = renderHook(useWorkspaceCanvasPtyTaskCompletion, {
      initialProps: { ...props, workspaceId: 'first' },
    })
    const originalNodes = state.nodesRef.current
    state.nodesRef.current = []
    rerender({ ...props, workspaceId: 'second' })
    state.nodesRef.current = originalNodes
    rerender({ ...props, workspaceId: 'first' })
    const requests = state.query.mock.calls.length
    await act(async () => state.resolve([state.summary]))
    expect(requests).toBe(2)
    expect(state.nodesRef.current[0].data.title).toBe('codex · Review persistence')
  })

  it.each(['claude_hook', 'pi_hook'] as const)(
    'projects cached %s state when recovery binds a node after the event arrived',
    source => {
      const state = setup()
      const originalNodes = state.nodesRef.current
      state.nodesRef.current = []
      const props = {
        nodesRef: state.nodesRef,
        nodes: state.nodesRef.current,
        setNodes: state.update,
        listAgentSessions: state.query,
      }
      const { rerender } = renderHook(useWorkspaceCanvasPtyTaskCompletion, { initialProps: props })
      act(() =>
        state.emitState({
          sessionId: 'runtime-1',
          state: 'standby',
          source,
          hookInstallState: 'installed',
        }),
      )
      state.nodesRef.current = originalNodes
      rerender({ ...props, nodes: originalNodes, setNodes: vi.fn(state.update) })
      expect(state.nodesRef.current[0].data.agentRuntimeObservation).toMatchObject({
        status: 'standby',
        source,
        hookInstallState: 'installed',
      })
    },
  )
})
