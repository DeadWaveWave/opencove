// @vitest-environment node
import { expect, it } from 'vitest'
import { registryWaitFixture } from './agentWaitRegistry.helpers'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'

function setup() {
  const f = registryWaitFixture()
  const runtime = new AgentRunStateRuntime(f.registry, () => 100)
  runtime.metadata({ sessionId: 's', agentProvider: 'claude-code', resumeSessionId: null })
  runtime.setBindings([{ sessionId: 's', nodeId: 'n', projectId: 'p', remote: false }])
  runtime.observe({
    sessionId: 's',
    source: 'claude_hook',
    hookEventName: 'UserPromptSubmit',
    state: 'working',
    observedAtMs: 100,
  })
  const turnId = f.registry.get({ nodeId: 'n' })!.turn!.id
  return { ...f, runtime, turnId }
}
it('routes a real Runtime permission observation to exact CLI attention and closes its subscription', async () => {
  const f = setup()
  try {
    f.onSubscribe(() =>
      f.runtime.observe({
        sessionId: 's',
        source: 'claude_hook',
        hookEventName: 'PermissionRequest',
        state: 'waiting',
        blockedReason: 'permission',
        observedAtMs: 101,
      }),
    )
    await expect(f.wait(f.turnId)).rejects.toMatchObject({
      exitCode: 10,
      details: {
        turnId: f.turnId,
        targets: [expect.objectContaining({ status: 'waiting', blockedReason: 'permission' })],
      },
    })
    expect(f.subscriptions()).toEqual({ opened: 1, closed: 1 })
    expect(f.query.mock.calls.every(([id]) => ['agent.list', 'agent.get'].includes(id))).toBe(true)
  } finally {
    f.runtime.dispose()
  }
})
it.each([false, true])('PTY exit yields state=11 or exact=0/unknown (exact=%s)', async exact => {
  const f = setup()
  try {
    f.onSubscribe(() => f.runtime.exit('s'))
    if (exact) {
      await expect(f.wait(f.turnId)).resolves.toMatchObject({
        turnId: f.turnId,
        outcome: 'unknown',
        state: 'exited',
      })
    } else {
      await expect(f.wait()).rejects.toMatchObject({ exitCode: 11 })
    }
    expect(f.subscriptions()).toEqual({ opened: 1, closed: 1 })
    expect(f.registry.get({ nodeId: 'n' })!.lastEndedTurn).toMatchObject({
      id: f.turnId,
      outcome: 'unknown',
    })
  } finally {
    f.runtime.dispose()
  }
})
