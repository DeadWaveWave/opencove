import { afterEach, describe, expect, it } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import { inMemoryCodexHookChannel } from '../../support/inMemoryClaudeHookChannel'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function fixture(hookCoverage: 'lifecycle' | 'notify_only') {
  let now = 1000,
    turn = 0
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: () => now,
    createTurnId: () => `turn-${++turn}`,
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, () => now)
  const socket = inMemoryCodexHookChannel()
  cleanups.push(
    () => runtime.dispose(),
    () => socket.channel.dispose(),
  )
  runtime.metadata({
    sessionId: 's',
    resumeSessionId: null,
    agentProvider: 'codex',
    agentLaunchKind: 'managed',
    hookCoverage,
    hookInstallState: 'installed',
  })
  const received: unknown[] = []
  socket.channel.onState(event => {
    received.push(getPromptSubmissionEvidence(event))
    runtime.observe(event)
  })
  const reservation = await socket.channel.reserveSpawn()
  reservation.commit('s')
  const token = reservation.env!.OPENCOVE_CODEX_HOOK_TOKEN!
  const post = async (name: string, id?: string) => {
    now += 900
    const payload =
      name === 'notify' || name === 'StopFailure'
        ? {
            version: 1,
            state: 'done',
            hookEventName: name,
            codexSessionId: 'codex',
            providerTurnId: id,
          }
        : { hook_event_name: name, session_id: 'codex', cwd: '/tmp', turn_id: id }
    expect(await socket.post(token, name, String(now), payload)).toBe(204)
  }
  return { registry, runtime, post, received, fence: () => registry.readFence({ sessionId: 's' })! }
}

describe('Codex notify run-state authority through the receiver', () => {
  it.each([undefined, 'T1', 'T2'])(
    'keeps the next lifecycle turn working after notify (ID: %s)',
    async id => {
      const f = await fixture('lifecycle')
      await f.post('UserPromptSubmit', 'T1')
      await f.post('Stop', 'T1')
      await f.post('UserPromptSubmit', 'T2')
      const active = f.fence()
      const watermark = f.registry.list().seq
      await f.post('notify', id)
      expect(f.fence()).toEqual(active)
      expect(f.registry.list().seq).toBe(watermark)
      expect(f.registry.list({ state: 'working' }).agents).toEqual([active.snapshot])
      expect(f.runtime.project(f.fence().snapshot).state).toBe('working')
      expect(f.fence().snapshot).toMatchObject({
        state: 'working',
        turn: { id: 'turn-2' },
        turnOutcome: null,
      })
    },
  )

  it('preserves a lifecycle permission wait after notify', async () => {
    const f = await fixture('lifecycle')
    await f.post('UserPromptSubmit', 'T2')
    await f.post('PermissionRequest', 'T2')
    const waiting = f.fence()
    await f.post('notify', 'T1')
    expect(f.fence()).toEqual(waiting)
    expect(f.fence().snapshot).toMatchObject({ state: 'waiting', blockedReason: 'permission' })
  })

  it.each(['Stop', 'StopFailure'])(
    'preserves lifecycle %s readiness and outcome after notify',
    async end => {
      const f = await fixture('lifecycle')
      await f.post('UserPromptSubmit', 'T1')
      await f.post(end, 'T1')
      const settled = f.fence()
      await f.post('notify', 'T1')
      expect(f.fence()).toEqual(settled)
      expect(f.fence().lastTurnEnd).toMatchObject({ hookEventName: end })
    },
  )

  it('ignores lifecycle notify before any turn evidence', async () => {
    const f = await fixture('lifecycle')
    const initial = f.fence()
    await f.post('notify', 'T1')
    expect(f.fence()).toEqual(initial)
  })

  it('retains validated Codex turn identity privately through the channel', async () => {
    const f = await fixture('notify_only')
    await f.post('UserPromptSubmit', 'T1')
    await f.post('notify', 'T1')
    expect(f.received).toEqual([
      expect.objectContaining({ providerTurnId: 'T1', providerSessionId: 'codex' }),
      expect.objectContaining({ providerTurnId: 'T1', providerSessionId: 'codex' }),
    ])
    expect(JSON.stringify(f.fence())).not.toContain('T1')
  })

  it('rejects a notify for a known different active fallback turn before state replacement', async () => {
    const f = await fixture('notify_only')
    await f.post('UserPromptSubmit', 'T2')
    const active = f.fence()
    await f.post('notify', 'T1')
    expect(f.fence()).toEqual(active)
    await f.post('notify', 'T2')
    expect(f.fence().snapshot).toMatchObject({
      state: 'idle',
      turn: null,
      turnOutcome: 'completed',
      lastEndedTurn: { id: 'turn-1', outcome: 'completed' },
    })
  })

  it.each([undefined, 'T1'])(
    'ends an uncorrelated fallback turn from notify (notify ID: %s)',
    async id => {
      const f = await fixture('notify_only')
      await f.post('UserPromptSubmit')
      await f.post('notify', id)
      expect(f.fence().snapshot).toMatchObject({
        state: 'idle',
        turn: null,
        turnOutcome: 'completed',
      })
    },
  )

  it('ends a session-file fallback turn from notify when no provider ID is available', async () => {
    const f = await fixture('notify_only')
    f.runtime.observe({
      sessionId: 's',
      source: 'session_file',
      state: 'working',
      hookEventName: 'task_started',
    })
    expect(f.fence().snapshot.turn).not.toBeNull()
    await f.post('notify', 'T1')
    expect(f.fence().snapshot).toMatchObject({
      state: 'idle',
      turn: null,
      turnOutcome: 'completed',
    })
  })

  it('ends an identified fallback turn when legacy notify has no turn ID', async () => {
    const f = await fixture('notify_only')
    await f.post('UserPromptSubmit', 'T1')
    await f.post('notify')
    expect(f.fence().snapshot).toMatchObject({
      state: 'idle',
      turn: null,
      turnOutcome: 'completed',
    })
  })
})
