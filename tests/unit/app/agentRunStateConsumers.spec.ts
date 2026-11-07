import { createPluginCanvasHost } from '../../../src/app/main/controlSurface/handlers/pluginCanvasHost'
import { describe, expect, it, vi } from 'vitest'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { createPtyEventHub } from '../../../src/app/renderer/shell/utils/ptyEventHub'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerAgentRunStateHandlers } from '../../../src/app/main/controlSurface/handlers/agentRunStateHandlers'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import type { WebSocket } from 'ws'

export function fixture() {
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: () => 100,
    createTurnId: () => 'turn',
    schedule: () => () => {},
    retention: 4,
  })
  const runtime = new AgentRunStateRuntime(registry, () => 100)
  const hub = new PtyStreamHub({
    agentRuns: runtime,
    replayWindowMaxBytes: 64000,
    ptyRuntime: {
      spawnSession: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => () => {},
      onExit: () => () => {},
    },
  })
  hub.registerSessionAgentMetadata({
    sessionId: 's',
    resumeSessionId: null,
    agentProvider: 'codex',
  })
  registry.bind('s', { nodeId: 'node', projectId: 'project', spaceId: 'space' })
  const surface = createControlSurface()
  registerAgentRunStateHandlers(surface, hub)
  return { registry, runtime, hub, surface }
}

describe('Worker agent authority consumers', () => {
  it.each(['agent', 'terminal'] as const)(
    'delivers the same waiting decision to renderer and plugin %s after newer file working',
    async kind => {
      const f = fixture()
      let onState: (event: TerminalSessionStateEvent) => void = () => {}
      const renderer = createPtyEventHub({
        onData: () => () => {},
        onExit: () => () => {},
        onState: listener => {
          onState = listener
          return () => {}
        },
      })
      const received: TerminalSessionStateEvent[] = []
      const unsubscribe = renderer.onState(event => received.push(event))
      f.hub.registerClient({
        clientId: 'renderer',
        kind: 'desktop',
        ws: {
          OPEN: 1,
          readyState: 1,
          send: (message: string) => {
            const event = JSON.parse(message)
            if (event.type === 'state') {
              onState(event)
            }
          },
        } as unknown as WebSocket,
      })
      try {
        f.hub.registerSessionAgentState({
          sessionId: 's',
          source: 'codex_hook',
          state: 'waiting',
          observedAtMs: 100,
          blockedReason: 'permission',
        })
        f.hub.registerSessionAgentState({
          sessionId: 's',
          source: 'session_file',
          state: 'working',
          observedAtMs: 101,
        })
        const control = {
          ...f.surface,
          invoke: vi.fn(async (_ctx, request) => ({
            ok: true as const,
            value:
              request.id === 'node.get'
                ? { node: { id: 'node', kind, sessionId: 's' } }
                : { sessions: [{ sessionId: 's' }] },
          })),
        }
        const host = createPluginCanvasHost(control, {
          ptyStreamHub: f.hub,
          context: {},
        } as Parameters<typeof createPluginCanvasHost>[1])
        const result = await host.request(
          { pluginId: 'test', ownerId: 'test', assertActive() {} },
          kind === 'agent' ? 'agents.get' : 'terminals.get',
          { nodeId: 'node' },
        )
        const plugin = (result as { agentState: unknown }).agentState
        expect(plugin).toMatchObject({ state: 'waiting', blockedReason: 'permission' })
        expect(received.at(-1)?.agentRunState).toEqual(plugin)
        expect(received.at(-1)?.state).toBe('waiting')
      } finally {
        unsubscribe()
        renderer.dispose()
        f.runtime.dispose()
      }
    },
  )

  it('serves validated read queries with a stable subscription watermark', async () => {
    const f = fixture()
    const ctx = { now: () => new Date(), capabilities: {} } as Parameters<
      typeof f.surface.invoke
    >[0]
    const invoke = (id: string, payload: unknown) =>
      f.surface.invoke(ctx, { kind: 'query', id, payload })
    expect(await invoke('agent.get', { nodeId: 'node' })).toMatchObject({
      ok: true,
      value: { sessionId: 's', state: 'unknown' },
    })
    expect(await invoke('agent.get', { nodeId: 'node', sessionId: 's' })).toMatchObject({
      ok: false,
    })
    expect(await invoke('agent.get', { sessionId: 's' })).toMatchObject({ ok: true })
    expect(
      await invoke('agent.list', { projectId: 'project', spaceId: 'space', state: 'unknown' }),
    ).toMatchObject({
      ok: true,
      value: { epoch: 'worker', seq: f.registry.list().seq, agents: [{ sessionId: 's' }] },
    })
    expect(await invoke('agent.list', { state: 'nonsense' })).toMatchObject({ ok: false })
    f.runtime.dispose()
  })

  it('feeds hook turn evidence but keeps remote raw evidence unknown', () => {
    const f = fixture()
    f.hub.registerSessionAgentState({
      sessionId: 's',
      source: 'codex_hook',
      state: 'working',
      hookEventName: 'SessionStart',
    })
    expect(f.registry.get({ sessionId: 's' })?.turn).toBeNull()
    f.hub.registerSessionAgentState({
      sessionId: 's',
      source: 'codex_hook',
      state: 'working',
      hookEventName: 'UserPromptSubmit',
    })
    expect(f.registry.get({ sessionId: 's' })?.turn?.id).toBe('turn')
    f.hub.registerSessionAgentState({
      sessionId: 's',
      source: 'codex_hook',
      state: 'standby',
      hookEventName: 'Stop',
    })
    expect(f.registry.get({ sessionId: 's' })?.turnOutcome).toBe('completed')
    f.hub.registerSessionAgentState({
      sessionId: 'remote',
      remote: true,
      agentProvider: 'codex',
      source: 'codex_hook',
      state: 'standby',
      hookEventName: 'Stop',
    })
    expect(f.registry.get({ sessionId: 'remote' })).toMatchObject({
      state: 'unknown',
      quality: 'degraded',
      turn: null,
    })
    f.runtime.dispose()
  })
  it.each(['metadata', 'binding'] as const)(
    'invalidates local evidence as soon as remote %s arrives',
    source => {
      const f = fixture()
      f.hub.registerSessionAgentState({
        sessionId: 's',
        source: 'codex_hook',
        state: 'working',
        hookEventName: 'UserPromptSubmit',
      })
      expect(f.registry.get({ sessionId: 's' })?.turn).not.toBeNull()
      if (source === 'metadata') {
        f.runtime.metadata({
          sessionId: 's',
          resumeSessionId: null,
          agentProvider: 'codex',
          remote: true,
        })
      } else {
        f.runtime.setBindings([
          { sessionId: 's', nodeId: 'node', projectId: 'project', remote: true },
        ])
      }
      expect(f.registry.get({ sessionId: 's' })).toMatchObject({
        state: 'unknown',
        quality: 'degraded',
        turn: null,
      })
      f.hub.registerSessionAgentState({
        sessionId: 's',
        source: 'codex_hook',
        state: 'standby',
        hookEventName: 'Stop',
      })
      expect(f.registry.get({ sessionId: 's' })?.state).toBe('unknown')
      f.runtime.dispose()
    },
  )

  it('keeps Pi conversation boundaries within their incarnation', () => {
    const f = fixture()
    const event = {
      sessionId: 'pi',
      source: 'pi_hook' as const,
      state: 'working' as const,
      piConversation: { pid: 1, revision: 1 },
    }
    f.runtime.observe({ ...event, hookEventName: 'agent_start' })
    expect(f.registry.get({ sessionId: 'pi' })?.turn).not.toBeNull()
    f.runtime.observe({ ...event, state: 'standby', piConversation: { pid: 1, revision: 2 } })
    f.runtime.observe({ ...event, state: 'standby', hookEventName: 'agent_settled' })
    expect(f.registry.get({ sessionId: 'pi' })).toMatchObject({
      state: 'idle',
      turn: null,
      turnOutcome: null,
    })
    f.runtime.dispose()
  })

  it('buffers provider-less evidence until identity arrives and discards it on exit', () => {
    const f = fixture()
    f.runtime.observe({ sessionId: 'late', state: 'working', hookEventName: 'task_started' })
    expect(f.registry.get({ sessionId: 'late' })).toBeNull()
    f.runtime.metadata({ sessionId: 'late', resumeSessionId: null, agentProvider: 'codex' })
    expect(f.registry.get({ sessionId: 'late' })?.turn?.start).toBe('observed')
    f.runtime.observe({ sessionId: 'gone', state: 'working', hookEventName: 'task_started' })
    f.runtime.exit('gone')
    f.runtime.metadata({ sessionId: 'gone', resumeSessionId: null, agentProvider: 'codex' })
    expect(f.registry.get({ sessionId: 'gone' })).toMatchObject({ state: 'unknown', turn: null })
    f.runtime.dispose()
  })
  it('keeps unavailable file evidence unknown rather than completing an observed turn', () => {
    const f = fixture()
    f.runtime.observe({
      sessionId: 'file',
      agentProvider: 'opencode',
      source: 'session_file',
      state: 'working',
      hookEventName: 'busy',
    })
    expect(f.registry.get({ sessionId: 'file' })?.turn?.start).toBe('inferred')
    f.runtime.observe({
      sessionId: 'file',
      source: 'session_file',
      state: 'standby',
      degraded: true,
    })
    expect(f.registry.get({ sessionId: 'file' })).toMatchObject({
      state: 'unknown',
      quality: 'degraded',
      turnOutcome: null,
    })
    expect(f.registry.get({ sessionId: 'file' })?.turn).not.toBeNull()
    f.runtime.dispose()
  })
  it('preserves failed hook installation across later file refreshes and clears it on healthy evidence', () => {
    const f = fixture()
    f.runtime.observe({
      sessionId: 's',
      state: 'standby',
      source: 'launch',
      hookInstallState: 'error',
    })
    f.runtime.observe({ sessionId: 's', state: 'standby', source: 'session_file' })
    expect(f.registry.get({ sessionId: 's' })).toMatchObject({
      state: 'unknown',
      quality: 'degraded',
    })
    expect(f.runtime.project(f.registry.get({ sessionId: 's' })!).hookInstallState).toBe('error')
    f.runtime.observe({
      sessionId: 's',
      state: 'working',
      source: 'codex_hook',
      hookInstallState: 'installed',
    })
    expect(f.registry.get({ sessionId: 's' })).toMatchObject({
      state: 'working',
      quality: 'authoritative',
    })
    f.runtime.dispose()
  })
  it('rejects a delayed prior-turn Stop at ingress without publishing idle or changing the current turn', () => {
    const f = fixture()
    const observe = (
      observedAtMs: number,
      hookEventName: string,
      state: TerminalSessionStateEvent['state'],
    ) =>
      f.runtime.observe({
        sessionId: 's',
        source: 'codex_hook',
        observedAtMs,
        hookEventName,
        state,
      })
    try {
      observe(100, 'UserPromptSubmit', 'working')
      observe(200, 'Stop', 'standby')
      observe(300, 'UserPromptSubmit', 'working')
      const before = f.registry.list()
      const delivered = vi.fn()
      const unsubscribe = f.registry.subscribe(
        { epoch: before.epoch, afterSeq: before.seq },
        {},
        delivered,
      )
      observe(200, 'Stop', 'standby') // Ingress assigns a fresh sequence despite the old timestamp.
      expect(f.registry.list()).toEqual(before)
      expect(f.hub.observeAgentState('s')).toMatchObject({
        state: 'working',
        quality: 'authoritative',
        turn: { startedAt: 300 },
        turnOutcome: null,
      })
      expect(delivered).not.toHaveBeenCalled()
      observe(300, 'Stop', 'standby') // Distinct events at the same timestamp remain valid.
      expect(f.hub.observeAgentState('s')).toMatchObject({
        state: 'idle',
        turn: null,
        turnOutcome: 'completed',
      })
      expect(delivered.mock.calls.map(([event]) => event.type)).toEqual([
        'agent.state_changed',
        'agent.turn_completed',
      ])
      unsubscribe()
    } finally {
      f.runtime.dispose()
    }
  })
})
