// @vitest-environment node
import { expect, it } from 'vitest'
import { hookChannelFixture } from './claudeHookTranscript.helpers'

it('a non-clear conversation end keeps invocation-authenticated state hooks alive', async () => {
  const f = await hookChannelFixture(),
    states: string[] = [],
    metadata: unknown[] = []
  f.channel.onState(event => states.push(event.hookEventName ?? ''))
  f.channel.onMetadata(event => metadata.push(event))
  const send = (name: string) =>
    f.post({
      session_id: 'provider',
      hook_event_name: name,
      transcript_path: '/tmp/provider.jsonl',
      cwd: '/',
    })
  try {
    await send('SessionStart')
    f.reservation.commit('s', {
      provider: 'claude-code',
      invocationId: 'inv-1',
      generation: 1,
      isCurrent: () => true,
    })
    expect(states).toEqual([])
    expect(metadata).toHaveLength(1)
    await send('UserPromptSubmit')
    await send('SessionStart')
    await send('SessionStart')
    await send('Stop')
    await send('SessionStart')
    await send('SessionEnd')
    await send('UserPromptSubmit')
    expect(states).toEqual(['UserPromptSubmit', 'Stop', 'SessionEnd', 'UserPromptSubmit'])
    expect(metadata).toHaveLength(1)
  } finally {
    await f.channel.dispose()
  }
})
it('an authenticated generation handoff clears the old degraded chain without granting readiness from SessionStart', async () => {
  const { continuationFixture } = await import('../contexts/claudeTurnContinuation.helpers')
  const f = await hookChannelFixture(),
    run = continuationFixture()
  f.channel.onState(event => run.runtime.observe(event))
  f.channel.onClaudeTranscript?.(record => run.runtime.observeClaudeTranscript(record))
  f.reservation.commit('s')
  let at = Date.now()
  const send = async (session: string, name: string, prompt?: string) => {
    await f.post(
      {
        session_id: session,
        hook_event_name: name,
        prompt_id: prompt,
        transcript_path: `/untrusted/projects/p/${session}.jsonl`,
        cwd: '/',
        last_assistant_message: 'reply',
      },
      at++,
    )
    run.tick(2000)
  }
  try {
    await send('provider', 'SessionStart')
    await send('provider', 'UserPromptSubmit', 'A')
    await send('provider', 'UserPromptSubmit', 'A')
    await send('provider', 'Stop', 'A')
    run.tick(5001)
    expect(run.snapshot().state).toBe('unknown')
    await send('provider', 'SessionEnd')
    await send('next', 'SessionStart')
    expect(run.snapshot().state).toBe('unknown')
    expect(run.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
    await send('next', 'Stop', 'premature')
    expect(run.snapshot().state).toBe('unknown')
    await send('next', 'UserPromptSubmit', 'C')
    expect(run.snapshot()).toMatchObject({ state: 'working', turn: { id: 't2' } })
    await send('next', 'Stop', 'C')
    expect(run.snapshot()).toMatchObject({ state: 'idle', quality: 'authoritative' })
  } finally {
    run.runtime.dispose()
    await f.channel.dispose()
  }
})
