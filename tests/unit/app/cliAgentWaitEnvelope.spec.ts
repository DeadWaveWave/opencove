// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'
import { fixture, snapshot } from './cliAgentWait.helpers'

it.each(['waiting', 'exited'] as const)(
  'CLI parses flags and prints a credential-free %s envelope with empty stdout',
  async state => {
    const f = identityFixture(false)
    const stream = fixture()
    const value = snapshot(node.id, state)
    f.values['agent.list'] = { epoch: 'e', seq: 0, agents: [value] }
    f.values['agent.get'] = value
    const original = f.io.fetch
    f.io.fetch = (url, init) =>
      String(url).includes('/events?') ? stream.fetch(url) : original(url, init)
    expect(
      await run(['agent', 'wait', '--node', node.id, '--until', 'idle', '-o', 'json'], f.io),
    ).toBe(state === 'waiting' ? 10 : 11)
    expect(f.out()).toBe('')
    expect(f.error()).toMatchObject({
      code: state === 'waiting' ? 'agent.wait_attention' : 'agent.wait_exited',
      details: {
        mode: 'all',
        until: 'idle',
        targets: [expect.objectContaining({ nodeId: node.id, status: state })],
      },
    })
    expect(JSON.stringify(f.error())).not.toContain('secret')
    expect(stream.streams).toHaveLength(1)
    expect(stream.streams[0].cancelled).toBe(true)
    expect(f.requests.every(r => !r.id.startsWith('session.') && !r.id.includes('prompt'))).toBe(
      true,
    )
  },
)
it('parses --through-waiting and does not suppress exit 11', async () => {
  const f = identityFixture(false)
  const stream = fixture()
  const value = snapshot(node.id, 'exited')
  f.values['agent.list'] = { epoch: 'e', seq: 0, agents: [value] }
  f.values['agent.get'] = value
  const original = f.io.fetch
  f.io.fetch = (url, init) =>
    String(url).includes('/events?') ? stream.fetch(url) : original(url, init)
  expect(
    await run(['agent', 'wait', '--node', node.id, '--until', 'idle', '--through-waiting'], f.io),
  ).toBe(11)
})
