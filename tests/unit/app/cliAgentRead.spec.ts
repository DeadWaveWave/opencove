// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'

const hook = {
  nodeId: node.id,
  sessionId: 'session-123456',
  turnId: 'turn-exact',
  promptId: 'prompt-1',
  outcome: 'completed',
  message: 'Hook reply.\n第二行',
  truncated: false,
  source: 'hook',
}
const transcript = {
  sessionId: hook.sessionId,
  provider: 'claude-code',
  startedAt: 'now',
  cwd: '/repo',
  resumeSessionId: 'r',
  message: 'Transcript reply',
}
function fixture(error?: { code: string; details?: unknown }) {
  const f = identityFixture(),
    original = f.io.fetch
  let stderr = ''
  f.io.stderr.write = text => {
    stderr += text
  }
  f.values['agent.finalMessage'] = hook
  f.values['session.finalMessage'] = transcript
  f.io.fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body))
    if (request.id === 'agent.finalMessage' && error) {
      f.requests.push(request)
      return new Response(JSON.stringify({ ok: false, error }))
    }
    return original(url, init)
  }
  return { ...f, stderr: () => stderr }
}
const args = ['agent', 'read', '--node', '@self']
function unavailable(reason: string) {
  return { code: 'agent.final_message_unavailable', details: { reason } }
}
it.each([false, true])('prefers hook text even with stdout TTY=%s', async tty => {
  const f = fixture()
  f.io.stdout.isTTY = tty
  expect(await run(args, f.io)).toBe(0)
  expect(f.out()).toBe(hook.message + '\n')
  expect(f.stderr()).toBe('')
  expect(f.requests.filter(r => r.id.endsWith('.finalMessage'))).toEqual([
    { id: 'agent.finalMessage', kind: 'query', payload: { nodeId: node.id } },
  ])
})
it.each(['', ' \n', 'Done\n'])(
  'preserves present hook content %j without fallback',
  async message => {
    const f = fixture()
    f.values['agent.finalMessage'] = { ...hook, message }
    expect(await run(args, f.io)).toBe(0)
    expect(f.out()).toBe(message)
    expect(f.requests.some(r => r.id === 'session.finalMessage')).toBe(false)
  },
)
it('returns the entire hook result as JSON and supports hook field projection', async () => {
  const f = fixture()
  expect(await run([...args, '-o', 'json'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual(hook)
  const projected = fixture()
  expect(await run([...args, '--fields', 'turnId,outcome,source,truncated'], projected.io)).toBe(0)
  expect(JSON.parse(projected.out())).toEqual({
    turnId: hook.turnId,
    outcome: hook.outcome,
    source: 'hook',
    truncated: false,
  })
})
it.each(
  ['agent', 'terminal'].flatMap(kind =>
    ['no_ended_turn', 'provider_sent_no_message'].map(reason => ({ kind, reason })),
  ),
)('falls back for a $kind only after latest hook reports $reason', async ({ kind, reason }) => {
  const f = fixture(unavailable(reason))
  f.values['node.get'] = { node: { ...node, kind } }
  expect(await run([...args, '-o', 'json'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ ...transcript, source: 'transcript', truncated: false })
  expect(f.requests.filter(r => r.id.endsWith('.finalMessage')).map(r => r.id)).toEqual([
    'agent.finalMessage',
    'session.finalMessage',
  ])
  const plain = fixture(unavailable(reason))
  plain.values['node.get'] = { node: { ...node, kind } }
  expect(await run(args, plain.io)).toBe(0)
  expect(plain.out()).toBe(transcript.message + '\n')
})
it.each([
  unavailable('turn_not_found'),
  unavailable('turn_not_ended'),
  unavailable('future_reason'),
  { code: 'agent.final_message_unavailable' },
  { code: 'common.unexpected', details: { reason: 'no_ended_turn' } },
  { code: 'common.forbidden' },
  { code: 'control.operation_not_found' },
])('never falls back for other errors: %j', async error => {
  const f = fixture(error)
  expect(await run(args, f.io)).not.toBe(0)
  expect(f.out()).toBe('')
  expect(JSON.parse(f.stderr()).error).toMatchObject(error)
  expect(f.requests.some(r => r.id === 'session.finalMessage')).toBe(false)
})
it('forwards --turn verbatim for exact selection, including with --last', async () => {
  const f = fixture()
  expect(await run([...args, '--turn', hook.turnId, '--last', '-o', 'json'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'agent.finalMessage')?.payload).toEqual({
    nodeId: node.id,
    turnId: hook.turnId,
  })
  expect(JSON.parse(f.out())).toEqual(hook)
})
it('does not expand a turn prefix or retry after an exact miss', async () => {
  const f = fixture(unavailable('turn_not_found'))
  expect(await run([...args, '--turn', 'turn-ex'], f.io)).toBe(1)
  expect(f.requests.filter(r => r.id.endsWith('.finalMessage'))).toEqual([
    { id: 'agent.finalMessage', kind: 'query', payload: { nodeId: node.id, turnId: 'turn-ex' } },
  ])
  expect(JSON.parse(f.stderr()).error.details.reason).toBe('turn_not_found')
})
it.each(
  ['agent', 'terminal'].flatMap(kind =>
    ['no_ended_turn', 'provider_sent_no_message', 'turn_not_found', 'turn_not_ended'].map(
      reason => ({ kind, reason }),
    ),
  ),
)(
  'preserves $kind exact-turn unavailable reason $reason without fallback',
  async ({ kind, reason }) => {
    const f = fixture(unavailable(reason))
    f.values['node.get'] = { node: { ...node, kind } }
    expect(await run([...args, '--turn', 'turn-exact'], f.io)).toBe(1)
    expect(f.out()).toBe('')
    expect(JSON.parse(f.stderr()).error).toMatchObject(unavailable(reason))
    expect(f.requests.find(r => r.id === 'agent.finalMessage')?.payload.turnId).toBe('turn-exact')
    expect(f.requests.some(r => r.id === 'session.finalMessage')).toBe(false)
  },
)
it.each([[], ['-o', 'json'], ['--fields', 'message']])(
  'prints exactly one actionable truncation notice with flags %j',
  async (...flags) => {
    const f = fixture()
    f.values['agent.finalMessage'] = { ...hook, truncated: true }
    expect(await run([...args, '--turn', hook.turnId, ...flags], f.io)).toBe(0)
    expect(f.stderr().trim().split('\n')).toHaveLength(1)
    expect(f.stderr()).toMatch(/cut|truncated/)
    expect(f.stderr()).toContain('session final --session session-123456')
    expect(f.stderr()).toContain('agent read --node node-123456 --screen')
    if (flags.length) {
      expect(JSON.parse(f.out()).message).toBe(hook.message)
      if (flags[0] === '-o') {
        expect(JSON.parse(f.out())).toEqual({ ...hook, truncated: true })
      }
    } else {
      expect(f.out()).toBe(hook.message + '\n')
    }
  },
)
it('rejects screen plus turn before connecting', async () => {
  const f = fixture()
  expect(await run([...args, '--screen', '--turn', hook.turnId], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})

it('explains an exact active turn with a concrete wait command and identifiers', async () => {
  const f = fixture(unavailable('turn_not_ended'))
  expect(await run([...args, '--turn', 'turn-live'], f.io)).toBe(1)
  expect(JSON.parse(f.stderr()).error).toMatchObject({
    code: 'agent.final_message_unavailable',
    message: expect.stringContaining('still running'),
    hint: expect.stringContaining(`opencove agent wait --node ${node.id} --turn turn-live`),
    details: { reason: 'turn_not_ended', nodeId: node.id, turnId: 'turn-live' },
  })
})

it.each([
  ['turn_not_found', 'last 8 ended turns', 'agent get'],
  ['provider_sent_no_message', 'provider sent no final message', '--screen'],
  ['no_ended_turn', 'no retained ended turn', 'session final'],
  ['remote_history_unavailable', 'remote turn history', 'Worker that runs them'],
])('explains exact %s without changing its code or reason', async (reason, message, hint) => {
  const f = fixture({
    code: 'agent.final_message_unavailable',
    details: { reason, sessionId: hook.sessionId },
  })
  expect(await run([...args, '--turn', 'turn-live'], f.io)).toBe(1)
  const error = JSON.parse(f.stderr()).error
  expect(error).toMatchObject({
    code: 'agent.final_message_unavailable',
    message: expect.stringContaining(message),
    hint: expect.stringContaining(hint),
    details: { reason, nodeId: node.id, sessionId: hook.sessionId, turnId: 'turn-live' },
  })
  expect(error.hint).toContain(node.id)
  expect(error.hint).not.toContain('<selector>')
  if (['no_ended_turn', 'provider_sent_no_message'].includes(reason)) {
    expect(error.hint).toContain(`opencove session final --session ${hook.sessionId}`)
  }
})
it('shell-quotes diagnostic selectors and turn IDs', async () => {
  const f = fixture(unavailable('turn_not_ended'))
  expect(await run([...args, '--turn', 'turn with space'], f.io)).toBe(1)
  expect(JSON.parse(f.stderr()).error.hint).toContain("--turn 'turn with space'")
})
