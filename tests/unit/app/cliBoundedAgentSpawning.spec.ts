// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture } from './cliIdentity.helpers'

it.each([undefined, false])(
  'refuses absent/false bounded capability before api call mutation (%s)',
  async capability => {
    const f = identityFixture()
    f.values['system.capabilities'] = {
      features: { nodeLineageV1: true, boundedAgentSpawningV1: capability },
    }
    delete f.io.env.OPENCOVE_ENV
    delete f.io.env.OPENCOVE_NODE_ID
    const code = await run(
      [
        'api',
        'call',
        'node.create',
        '--input',
        JSON.stringify({ kind: 'agent', projectId: 'project-123456', data: { prompt: '' } }),
      ],
      f.io,
    )
    expect(code).toBe(5)
    expect(f.requests.some(r => r.id === 'node.create')).toBe(false)
    expect(f.error()).toMatchObject({
      message: 'This Worker does not support bounded agent spawning.',
      retryable: false,
    })
  },
)
it('preserves bearer standalone launch without bounded capability', async () => {
  const f = identityFixture(false)
  f.values['session.launchAgent'] = { sessionId: 'standalone' }
  expect(
    await run(
      [
        'api',
        'call',
        'session.launchAgent',
        '--input',
        JSON.stringify({ cwd: '/repo', prompt: 'Help' }),
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.map(r => r.id)).toEqual(['system.whoami', 'session.launchAgent'])
})
it('does not negotiate limits for non-runtime creation and does not downgrade invalid whoami', async () => {
  const f = identityFixture()
  expect(
    await run(
      [
        'api',
        'call',
        'node.create',
        '--input',
        JSON.stringify({ kind: 'note', projectId: 'project-123456', data: { text: '' } }),
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.map(r => r.id)).toEqual(['node.create'])
  f.values['system.whoami'] = {}
  expect(
    await run(
      ['api', 'call', 'pty.spawn', '--input', JSON.stringify({ cwd: '/repo', cols: 80, rows: 24 })],
      f.io,
    ),
  ).toBe(1)
  expect(f.requests.some(r => r.id === 'pty.spawn')).toBe(false)
})

it.each(['agent.spawn_depth_limit', 'agent.spawn_concurrency_limit'])(
  'renders %s with a finished hint and retryable false',
  async code => {
    const f = identityFixture(),
      originalFetch = f.io.fetch
    f.io.fetch = async (url, init) => {
      const request = JSON.parse(String(init?.body))
      if (request.id === 'node.create') {
        return new Response(
          JSON.stringify({ ok: false, error: { code, details: { retryable: false } } }),
        )
      }
      return originalFetch(url, init)
    }
    expect(
      await run(
        [
          'api',
          'call',
          'node.create',
          '--input',
          JSON.stringify({ kind: 'agent', projectId: 'project-123456', data: { prompt: '' } }),
        ],
        f.io,
      ),
    ).toBe(1)
    expect(f.error()).toMatchObject({
      code,
      retryable: false,
      message: expect.any(String),
      hint: expect.any(String),
    })
    expect(f.error().message).not.toBe(code)
  },
)
