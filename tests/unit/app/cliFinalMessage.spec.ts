// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'
const reply = {
  sessionId: 'session-123456',
  provider: 'claude-code',
  message: 'Done',
  resumeSessionId: 'r',
}
function fixture(message: string | null, state = 'idle') {
  const f = identityFixture()
  f.values['session.finalMessage'] = { ...reply, message }
  f.values['agent.get'] = {
    nodeId: node.id,
    sessionId: reply.sessionId,
    state,
    turn: null,
    turnOutcome: 'completed',
  }
  return f
}
it.each([null, '', ' \r\n '])(
  'gives both commands identical absent-message recovery for %j',
  async message => {
    const agent = fixture(message),
      session = fixture(message)
    expect(await run(['agent', 'read', '--node', '@self'], agent.io)).toBe(1)
    expect(await run(['session', 'final', '--session', reply.sessionId], session.io)).toBe(1)
    expect(agent.out()).toBe('')
    expect(session.out()).toBe('')
    expect(agent.error()).toEqual(session.error())
    expect(session.error()).toMatchObject({
      code: 'session.transcript_not_ready',
      message: expect.stringContaining('No readable final message is available for this session.'),
      hint: expect.stringContaining('--screen'),
    })
    expect(session.error().hint).not.toContain('wait')
  },
)
it('applies the same working-state recovery to both commands', async () => {
  const a = fixture(null, 'working'),
    s = fixture('', 'working')
  await run(['agent', 'read', '--node', '@self'], a.io)
  await run(['session', 'final', '--session', reply.sessionId], s.io)
  expect(a.error()).toEqual(s.error())
  expect(s.error().hint).toContain('--until idle')
})
it.each([
  ['agent', 'read', '--node', '@self'],
  ['session', 'final', '--session', reply.sessionId],
])('validates before projection: %j', async (...argv) => {
  const f = fixture(null)
  expect(await run([...argv, '--fields', 'sessionId'], f.io)).toBe(1)
  expect(f.out()).toBe('')
})
it('preserves session final JSON and agent read text for a nonblank reply', async () => {
  const a = fixture('  Done\n'),
    s = fixture('  Done\n')
  expect(await run(['agent', 'read', '--node', '@self'], a.io)).toBe(0)
  expect(a.out()).toBe('  Done\n')
  expect(await run(['session', 'final', '--session', reply.sessionId], s.io)).toBe(0)
  expect(JSON.parse(s.out()).message).toBe('  Done\n')
})

it.each(['idle', 'working'])(
  'maps explicit node transcript errors and legacy nulls identically in state %s',
  async state => {
    const agent = fixture(null, state),
      session = fixture(null, state),
      original = agent.io.fetch
    agent.io.fetch = async (url, init) =>
      JSON.parse(String(init?.body)).id === 'session.finalMessage'
        ? new Response(
            JSON.stringify({ ok: false, error: { code: 'session.transcript_not_ready' } }),
          )
        : original(url, init)
    await run(['agent', 'read', '--node', '@self'], agent.io)
    await run(['session', 'final', '--session', reply.sessionId], session.io)
    expect(agent.error()).toEqual(session.error())
  },
)
