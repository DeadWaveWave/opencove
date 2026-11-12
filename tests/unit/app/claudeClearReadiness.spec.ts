// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { continuationFixture } from '../contexts/claudeTurnContinuation.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

const disposals: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(disposals.splice(0).map(dispose => dispose()))
})
async function fixture() {
  const hooks = await hookChannelFixture(),
    run = continuationFixture()
  run.registry.bind('s', { nodeId: 'n' })
  run.runtime.metadata({
    sessionId: 's',
    agentProvider: 'claude-code',
    resumeSessionId: null,
    agentLaunchKind: 'managed',
    hookCoverage: 'lifecycle',
    hookInstallState: 'installed',
  })
  hooks.channel.onState(event => run.runtime.observe(event))
  hooks.channel.onClaudeTranscript?.(record => run.runtime.observeClaudeTranscript(record))
  hooks.reservation.commit('s')
  disposals.push(async () => {
    run.runtime.dispose()
    await hooks.channel.dispose()
  })
  const at = Date.now()
  const send = (id: string, name: string, offset: number, promptId?: string, source?: string) =>
    hooks.post(
      {
        session_id: id,
        hook_event_name: name,
        prompt_id: promptId,
        source,
        cwd: '/',
        transcript_path: `/untrusted/projects/p/${id}.jsonl`,
        last_assistant_message: `reply-${id}`,
        ...(name === 'PermissionRequest' ? { tool_name: 'Bash' } : {}),
      },
      at + offset,
    )
  const fence = () => run.registry.readFence({ sessionId: 's' })!
  const admission = () => promptAdmission(fence(), () => ({ supported: true, submitDelayMs: 1 }))
  await send('A', 'SessionStart', 1)
  await send('A', 'UserPromptSubmit', 2, 'same')
  await send('A', 'Stop', 3, 'same')
  return { run, send, fence, admission }
}
it('admits empty new-ID clear without a B Stop, preserves A and correlates reused prompt IDs', async () => {
  const f = await fixture()
  await f.send('B', 'SessionStart', 4, undefined, 'clear')
  expect(f.fence()).toMatchObject({ lastTurnEnd: null, snapshot: { state: 'idle', turn: null } })
  expect(f.admission()).toBeNull()
  expect(f.run.registry.promptIdentity(f.fence())).toMatchObject({ providerSessionId: 'B' })
  expect(f.run.registry.promptIdentity(f.fence())?.promptId).toBeUndefined()
  await f.send('A', 'UserPromptSubmit', 5, 'late')
  await f.send('A', 'StopFailure', 6, 'same')
  await f.send('A', 'SessionEnd', 7)
  expect(f.admission()).toBeNull()
  await f.send('B', 'UserPromptSubmit', 8, 'same')
  expect(f.run.snapshot().turn?.id).toBe('t2')
  await f.send('B', 'Stop', 9, 'same')
  expect(f.run.read({ turnId: 't1' })).toMatchObject({ message: 'reply-A' })
  expect(f.run.read({ turnId: 't2' })).toMatchObject({ message: 'reply-B' })
})
it.each(['UserPromptSubmit', 'PermissionRequest'])(
  'quarantines %s before delayed Start and folds it before publishing readiness',
  async name => {
    const f = await fixture()
    await f.send('B', name, 6, 'b')
    expect(f.admission()).not.toBeNull()
    await f.send('B', 'SessionStart', 5, undefined, 'clear')
    expect(f.admission()).not.toBeNull()
    expect(f.run.snapshot().state).toBe(name === 'PermissionRequest' ? 'waiting' : 'working')
  },
)
it('retires active A once, rejects duplicate receipts and keeps same-ID clear conservative', async () => {
  const f = await fixture()
  await f.send('A', 'UserPromptSubmit', 4, 'active')
  await f.send('B', 'SessionStart', 5, undefined, 'clear')
  expect(f.run.snapshot().lastEndedTurn).toMatchObject({ id: 't2', outcome: 'unknown' })
  const generation = f.fence().conversationGeneration
  await f.send('B', 'SessionStart', 5, undefined, 'clear')
  expect(f.fence().conversationGeneration).toBe(generation)
  expect(f.admission()).toBeNull()
  await f.send('B', 'SessionStart', 6, undefined, 'clear')
  expect(f.admission()).not.toBeNull()
})
it.each(['missing', 'meta-only', 'user', 'queue', 'old-error'])(
  'treats %s transcript evidence conservatively before B has a turn',
  async kind => {
    const f = await fixture()
    await f.send('B', 'SessionStart', 4, undefined, 'clear')
    f.run.record(
      kind === 'user'
        ? { kind: 'user', promptId: 'b', promptSource: 'typed' }
        : kind === 'queue'
          ? { kind: 'queue', operation: 'enqueue' }
          : undefined,
      {
        providerSessionId: 'B',
        origin: 'hook',
        generation: 100,
        conversationGeneration:
          kind === 'old-error'
            ? f.fence().conversationGeneration! - 1
            : f.fence().conversationGeneration,
        unavailable: kind === 'missing' || kind === 'old-error',
      },
    )
    expect(f.admission() === null).toBe(!['user', 'queue'].includes(kind))
  },
)
it('keeps quarantine after buffer expiry rather than resurrecting A readiness', async () => {
  const f = await fixture()
  await f.send('B', 'UserPromptSubmit', 6, 'b')
  f.run.tick(2001)
  await f.send('B', 'SessionStart', 5, undefined, 'clear')
  expect(f.admission()).not.toBeNull()
  expect(f.run.snapshot().turn).toBeNull()
})
it('fails closed on orphan overflow and never grants readiness from lost conflicts', async () => {
  const f = await fixture()
  for (let i = 0; i < 17; i++) {
    // oxlint-disable-next-line no-await-in-loop -- arrival order is the tested invariant
    await f.send('B', 'UserPromptSubmit', 6 + i, `b${i}`)
  }
  await f.send('B', 'SessionStart', 5, undefined, 'clear')
  expect(f.admission()).not.toBeNull()
})
it('does not restore a clear receipt when hook coverage recovers', async () => {
  const f = await fixture()
  await f.send('B', 'SessionStart', 4, undefined, 'clear')
  const context = {
    remote: false,
    launchKind: 'managed' as const,
    hookCoverage: 'lifecycle' as const,
  }
  f.run.registry.setRuntimeContext('s', { ...context, hookInstallState: 'error' })
  f.run.registry.setRuntimeContext('s', { ...context, hookInstallState: 'installed' })
  expect(f.admission()).not.toBeNull()
})

it.each(['terminal', 'unverified', 'remote', 'legacy'] as const)(
  'preserves %s refusal after clear',
  async kind => {
    const f = await fixture()
    f.run.registry.setRuntimeContext('s', {
      remote: kind === 'remote',
      launchKind: kind === 'legacy' ? undefined : kind === 'terminal' ? 'terminal' : 'managed',
      hookCoverage: kind === 'unverified' ? 'unverified_executable' : 'lifecycle',
      hookInstallState: 'installed',
    })
    await f.send('B', 'SessionStart', 4, undefined, 'clear')
    expect(f.fence().claudeClearReady).toBe(false)
    expect(f.admission()).not.toBeNull()
  },
)
