// @vitest-environment node
import { expect, it } from 'vitest'
import { createCodexHookChannel } from '../../../src/app/main/controlSurface/agentHook/codexHookChannel'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'

it('Codex SessionStart publishes identity without inventing work or resetting an active turn', async () => {
  const channel = createCodexHookChannel()
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: Date.now,
    createTurnId: () => 'turn',
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, Date.now)
  runtime.metadata({ sessionId: 'runtime', agentProvider: 'codex', resumeSessionId: null })
  const metadata: string[] = []
  channel.onMetadata(event => {
    metadata.push(event.resumeSessionId!)
    runtime.metadata(event)
  })
  channel.onState(event => runtime.observe(event))
  const reservation = await channel.reserveSpawn()
  reservation.commit('runtime')
  const send = async (name: string) => {
    const response = await fetch(reservation.env!.OPENCOVE_CODEX_HOOK_ENDPOINT!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-opencove-hook-token': reservation.env!.OPENCOVE_CODEX_HOOK_TOKEN!,
      },
      body: JSON.stringify({
        session_id: 'provider',
        cwd: '/workspace',
        hook_event_name: name,
        model: 'test',
      }),
    })
    expect(response.status).toBe(204)
  }
  try {
    await send('SessionStart')
    expect(metadata).toEqual(['provider'])
    expect(registry.get({ sessionId: 'runtime' })).toMatchObject({ state: 'unknown', turn: null })
    await send('UserPromptSubmit')
    const active = registry.get({ sessionId: 'runtime' })!
    expect(active).toMatchObject({ state: 'working', turn: { id: 'turn' } })
    await send('SessionStart')
    expect(registry.get({ sessionId: 'runtime' })).toEqual(active)
    await send('Stop')
    expect(registry.get({ sessionId: 'runtime' })).toMatchObject({
      state: 'idle',
      lastEndedTurn: { id: 'turn' },
    })
  } finally {
    await reservation.dispose()
    await channel.dispose()
    runtime.dispose()
    registry.dispose()
  }
})
