// @vitest-environment node
import { expect, it } from 'vitest'
import { promptAdmission } from '../../src/contexts/agent/application/promptAdmission'
import { AgentRunStateRegistry } from '../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../src/contexts/agent/application/AgentRunStateRuntime'
import type { AgentRunEvent } from '../../src/shared/contracts/dto/agentRunState'
import { inMemoryClaudeHookChannel } from '../support/inMemoryClaudeHookChannel'
import { promptDeliveryRuntimeFixture } from '../support/promptDeliveryRuntimeFixture'
import { createControlSurface } from '../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../src/app/main/controlSurface/types'
import { registerAgentRunStateHandlers } from '../../src/app/main/controlSurface/handlers/agentRunStateHandlers'

it('carries Claude 2.1.319 shape through channel, runtime, registry and the interact query without leaking content', async () => {
  const f = promptDeliveryRuntimeFixture()
  const { channel, post } = inMemoryClaudeHookChannel()
  const reservation = await channel.reserveSpawn()
  reservation.commit('s')
  channel.onState(event => f.hub.registerSessionAgentState(event))
  const surface = createControlSurface()
  registerAgentRunStateHandlers(surface, f.hub)
  const invoke = (
    payload: unknown,
    scopeTier: 'read' | 'interact' = 'interact',
    assertActive?: () => void,
  ) =>
    surface.invoke(
      {
        now: () => new Date(),
        capabilities: {} as ControlSurfaceContext['capabilities'],
        requestAuth: {
          kind: 'session-grant',
          grant: {
            tier: scopeTier,
            grantId: 'g',
            createdAt: '',
            nodeId: 'sibling',
            sessionId: 'sibling',
            projectId: 'different-project',
            spaceId: 'space',
          },
        },
        assertActive,
      },
      { kind: 'query', id: 'agent.finalMessage', payload },
    )
  const payload = { session_id: 'provider', transcript_path: '/tmp/t', cwd: '/tmp', prompt_id: 'p' }
  const token = reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!
  try {
    expect(
      await post(token, '', undefined, {
        ...payload,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'question',
      }),
    ).toBe(204)
    expect((await invoke({ nodeId: 'n', promptId: 'p' })).ok).toBe(false)
    expect(
      await post(token, '', undefined, {
        ...payload,
        hook_event_name: 'Stop',
        last_assistant_message: 'answer🙂',
        stop_hook_active: false,
      }),
    ).toBe(204)
    expect(await invoke({ nodeId: 'n', turnId: 'turn' })).toMatchObject({
      ok: true,
      value: { message: 'answer🙂', promptId: 'p', source: 'hook', truncated: false },
    })
    expect(await invoke({ sessionId: 's', promptId: 'p' })).toMatchObject({
      ok: true,
      value: { message: 'answer🙂' },
    })
    expect(await invoke({ sessionId: 's' }, 'read')).toMatchObject({
      ok: false,
      error: { code: 'common.forbidden' },
    })
    expect(await invoke({ sessionId: 's', nodeId: 'n' })).toMatchObject({
      ok: false,
      error: { code: 'common.invalid_input' },
    })
    expect(await invoke({ sessionId: 's', turnId: 'turn', promptId: 'p' })).toMatchObject({
      ok: false,
      error: { code: 'common.invalid_input' },
    })
    expect(
      await invoke({ sessionId: 's' }, 'interact', () => {
        throw new Error('revoked')
      }),
    ).toMatchObject({ ok: false })
    expect(JSON.stringify(f.registry.list())).not.toContain('answer')
  } finally {
    await channel.dispose()
    f.dispose()
  }
})

async function hookRuntimeFixture() {
  let now = 100,
    turn = 0
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => now,
    createTurnId: () => `t${++turn}`,
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, () => ++now)
  runtime.metadata({
    sessionId: 's',
    agentProvider: 'claude-code',
    resumeSessionId: null,
    agentLaunchKind: 'managed',
    hookCoverage: 'lifecycle',
    hookInstallState: 'installed',
  })
  registry.bind('s', { nodeId: 'n' })
  const { channel, post } = inMemoryClaudeHookChannel()
  const reservation = await channel.reserveSpawn()
  reservation.commit('s')
  channel.onState(event => runtime.observe(event))
  const completions: AgentRunEvent[] = []
  registry.subscribe(
    { epoch: 'e', afterSeq: registry.list().seq },
    { types: ['agent.turn_completed'] },
    event => {
      if (event.type === 'agent.turn_completed') {
        completions.push(event)
      }
    },
  )
  const emissionBase = Date.now() - 30000
  let emissionSequence = 0
  const send = async (promptId: string, stop = false, timing?: { emittedAtMs?: number }) => {
    const emittedAtMs = timing ? timing.emittedAtMs : emissionBase + ++emissionSequence * 100
    expect(
      await post(
        reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!,
        '',
        emittedAtMs === undefined ? undefined : String(emittedAtMs),
        {
          session_id: 'provider',
          transcript_path: '/tmp/t',
          cwd: '/tmp',
          prompt_id: promptId,
          hook_event_name: stop ? 'Stop' : 'UserPromptSubmit',
          ...(stop
            ? { last_assistant_message: `${promptId} answer`, stop_hook_active: false }
            : { prompt: promptId }),
        },
      ),
    ).toBe(204)
    return emittedAtMs
  }
  const completeTurns = async (count: number) => {
    // Eviction depends on ordered, completed lifecycle pairs, not concurrent delivery.
    for (let i = 1; i <= count; i++) {
      await send(`p${i}`)
      await send(`p${i}`, true)
    }
  }
  return {
    registry,
    runtime,
    channel,
    completions,
    send,
    completeTurns,
    ready: () =>
      promptAdmission(registry.readFence({ nodeId: 'n' }), () => ({
        supported: true,
        submitDelayMs: 0,
      })),
    dispose: async () => {
      await channel.dispose()
      runtime.dispose()
    },
  }
}

it.each(['none', 'while-b-active', 'after-b-ended', 'while-c-active', 'after-c-ended'])(
  'recovers missing Claude ends through the real channel with late A Stop: %s',
  async late => {
    const { registry, runtime, channel, completions, send } = await hookRuntimeFixture()
    const unavailableA = () =>
      expect(() => registry.finalMessage({ nodeId: 'n', turnId: 't1' })).toThrow(
        expect.objectContaining({
          code: 'agent.final_message_unavailable',
          // A superseded turn's end was never observed: no message and an unknown outcome.
          details: expect.objectContaining({
            reason: 'provider_sent_no_message',
            outcome: 'unknown',
          }),
        }),
      )
    try {
      await send('a')
      await send('b')
      expect(registry.get({ nodeId: 'n' })).toMatchObject({
        state: 'working',
        turn: { id: 't2' },
        turnOutcome: 'unknown',
      })
      expect(completions).toHaveLength(1)
      expect(completions[0]).toMatchObject({
        endedTurn: { id: 't1' },
        snapshot: { turnOutcome: 'unknown' },
      })
      unavailableA()
      if (late === 'while-b-active') {
        await send('a', true)
      }
      await send('b', true)
      expect(registry.finalMessage({ nodeId: 'n', promptId: 'b' })).toMatchObject({
        turnId: 't2',
        message: 'b answer',
        outcome: 'completed',
      })
      if (late === 'after-b-ended') {
        await send('a', true)
      }
      await send('c')
      if (late === 'while-c-active') {
        await send('a', true)
      }
      await send('c', true)
      const finalFence = registry.readFence({ nodeId: 'n' })
      if (late === 'after-c-ended') {
        await send('a', true)
        expect(registry.readFence({ nodeId: 'n' })).toEqual(finalFence)
      }
      expect(registry.get({ nodeId: 'n' })).toMatchObject({
        state: 'idle',
        turn: null,
        turnOutcome: 'completed',
      })
      expect(registry.finalMessage({ nodeId: 'n', turnId: 't2' })).toMatchObject({
        promptId: 'b',
        message: 'b answer',
      })
      expect(registry.finalMessage({ nodeId: 'n', turnId: 't3' })).toMatchObject({
        promptId: 'c',
        message: 'c answer',
      })
      unavailableA()
      expect(() => registry.finalMessage({ nodeId: 'n', promptId: 'a' })).toThrow(
        expect.objectContaining({
          details: expect.objectContaining({
            reason: 'provider_sent_no_message',
            outcome: 'unknown',
          }),
        }),
      )
      expect(completions.map(event => [event.endedTurn?.id, event.snapshot.turnOutcome])).toEqual([
        ['t1', 'unknown'],
        ['t2', 'completed'],
        ['t3', 'completed'],
      ])
    } finally {
      await channel.dispose()
      runtime.dispose()
    }
  },
)

it.each(['completed', 'superseded'])(
  'preserves live work when an evicted %s prompt is replayed',
  async outcome => {
    const f = await hookRuntimeFixture()
    try {
      const originalEmission = await f.send('a')
      if (outcome === 'completed') {
        await f.send('a', true)
      }
      await f.completeTurns(8)
      expect(() => f.registry.finalMessage({ nodeId: 'n', promptId: 'a' })).toThrow(
        expect.objectContaining({ details: { reason: 'turn_not_found' } }),
      )
      await f.send('live')
      const running = f.registry.readFence({ nodeId: 'n' })!
      const completedCount = f.completions.length
      await f.send('a', false, { emittedAtMs: originalEmission })
      expect.soft(f.registry.readFence({ nodeId: 'n' })).toEqual(running)
      expect.soft(f.completions).toHaveLength(completedCount)
      expect
        .soft(() => f.registry.finalMessage({ nodeId: 'n', turnId: running.snapshot.turn!.id }))
        .toThrow(expect.objectContaining({ details: { reason: 'turn_not_ended' } }))
      await f.send('live', true)
      expect
        .soft(f.registry.finalMessage({ nodeId: 'n', turnId: running.snapshot.turn!.id }))
        .toMatchObject({
          promptId: 'live',
          message: 'live answer',
          outcome: 'completed',
        })
      expect.soft(f.registry.get({ nodeId: 'n' })).toMatchObject({ state: 'idle', turn: null })
    } finally {
      await f.dispose()
    }
  },
)
it('rejects an evicted submit and Stop replay before live work ends without granting readiness', async () => {
  const f = await hookRuntimeFixture()
  try {
    const originalEmission = await f.send('a')
    const originalStopEmission = await f.send('a', true)
    await f.completeTurns(8)
    await f.send('live')
    const running = f.registry.readFence({ nodeId: 'n' })!
    await f.send('a', false, { emittedAtMs: originalEmission })
    await f.send('a', true, { emittedAtMs: originalStopEmission })
    expect.soft(f.registry.readFence({ nodeId: 'n' })).toEqual(running)
    expect.soft(f.ready()).toEqual({ code: 'agent.busy', reason: 'working' })
    await f.send('live', true)
    expect(
      f.registry.finalMessage({ nodeId: 'n', turnId: running.snapshot.turn!.id }),
    ).toMatchObject({ message: 'live answer' })
    expect(f.ready()).toBeNull()
  } finally {
    await f.dispose()
  }
})
it.each(['active-missing', 'candidate-missing', 'both-missing', 'equal', 'older'])(
  'rejects a distinct submit without strict emission freshness: %s',
  async timing => {
    const f = await hookRuntimeFixture()
    const emitted = Date.now() - 10000
    try {
      await f.send('a', false, {
        emittedAtMs: ['active-missing', 'both-missing'].includes(timing) ? undefined : emitted,
      })
      const active = f.registry.readFence({ nodeId: 'n' })!
      await f.send('b', false, {
        emittedAtMs: ['candidate-missing', 'both-missing'].includes(timing)
          ? undefined
          : timing === 'equal'
            ? emitted
            : timing === 'older'
              ? emitted - 1
              : emitted + 1,
      })
      expect.soft(f.registry.readFence({ nodeId: 'n' })).toEqual(active)
      expect.soft(f.completions).toHaveLength(0)
      expect.soft(f.ready()).toEqual({ code: 'agent.busy', reason: 'working' })
      await f.send('b', true)
      expect.soft(f.registry.readFence({ nodeId: 'n' })).toEqual(active)
      await f.send('a', true)
      expect(
        f.registry.finalMessage({ nodeId: 'n', turnId: active.snapshot.turn!.id }),
      ).toMatchObject({ message: 'a answer' })
    } finally {
      await f.dispose()
    }
  },
)
it.each(['completed', 'superseded'])(
  'rejects retained %s IDs even with a strictly newer emission timestamp',
  async outcome => {
    const f = await hookRuntimeFixture()
    try {
      await f.send('a')
      if (outcome === 'completed') {
        await f.send('a', true)
      }
      await f.completeTurns(7)
      await f.send('live')
      const active = f.registry.readFence({ nodeId: 'n' })
      await f.send('a')
      await f.send('a', true)
      expect(f.registry.readFence({ nodeId: 'n' })).toEqual(active)
      expect(f.ready()).toEqual({ code: 'agent.busy', reason: 'working' })
      await f.send('live', true)
      expect(f.registry.finalMessage({ nodeId: 'n', promptId: 'live' })).toMatchObject({
        message: 'live answer',
      })
    } finally {
      await f.dispose()
    }
  },
)
