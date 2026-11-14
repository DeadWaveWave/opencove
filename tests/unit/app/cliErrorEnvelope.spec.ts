// @vitest-environment node
import { expect, it } from 'vitest'
import { CliError, printError } from '../../../src/app/cli/core/errors'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'

it.each([
  ['context.unreachable', false],
  ['transport.timeout', false],
  ['agent.wait_timeout', false],
  ['agent.prompt_stalled', false],
  ['agent.prompt_timeout', false],
  ['agent.busy', false],
  ['common.invalid_input', false],
  ['common.forbidden', false],
  ['cli.ambiguous', false],
  ['node.not_found', false],
  ['new.error', false],
])('classifies %s conservatively', (code, retryable) => {
  const f = identityFixture(false)
  printError(f.io, new CliError(code, 1, 'Failed'), true)
  expect(f.error().retryable).toBe(retryable)
})
it.each([
  { deliveryOutcome: 'unknown' },
  { pasteDispatchAttempted: true },
  { submitDispatchAttempted: true },
])('never retries allowed conditions after possible input: %j', flags => {
  const f = identityFixture(false)
  printError(
    f.io,
    new CliError('context.unreachable', 3, 'Unknown', undefined, {
      reason: 'connection_refused',
      ...flags,
    }),
    true,
  )
  expect(f.error().retryable).toBe(false)
})
it('promotes ambiguity candidates while preserving details and renders them on TTY', async () => {
  for (const tty of [false, true]) {
    const f = identityFixture(false)
    let stderr = ''
    f.io.stderr = {
      isTTY: tty,
      write: text => {
        stderr += text
      },
    }
    f.values['node.list'] = { nodes: [node, { ...node, id: 'other-node' }] }
    expect(await run(['node', 'get', '--node', 'Shell'], f.io)).toBe(6)
    if (tty) {
      expect(stderr).toContain(node.id)
      expect(stderr).toContain('other-node')
    } else {
      const { error } = JSON.parse(stderr)
      expect(error.candidates).toEqual(error.details.candidates)
      expect(error.candidates).toHaveLength(2)
      expect(error.retryable).toBe(false)
    }
  }
})
it('exposes suggested targets on not-found errors', async () => {
  const f = identityFixture(false)
  expect(await run(['node', 'get', '--node', 'Shel'], f.io)).toBe(1)
  expect(f.error().candidates).toContainEqual(
    expect.objectContaining({ id: node.id, title: 'Shell' }),
  )
})
it.each([['ping'], ['node', 'create', 'note', '--space', 'space-123456']].map(args => ({ args })))(
  'only marks unreachable reads as retryable after dispatch: %j',
  async ({ args }) => {
    const f = identityFixture(false)
    const original = f.io.fetch!
    f.io.fetch = async (url, init) => {
      const { id } = JSON.parse(String(init?.body))
      if (id === 'system.ping' || id === 'node.create') {
        throw new TypeError('Disconnected', { cause: { code: 'ECONNREFUSED' } })
      }
      return original(url, init)
    }
    expect(await run(args, f.io)).toBe(3)
    expect(f.error().retryable).toBe(args[0] === 'ping')
  },
)

it.each(['space', 'profile'])(
  'exposes normalized %s ambiguity candidates without changing legacy details',
  kind => {
    const f = identityFixture(false)
    const details =
      kind === 'space'
        ? { candidates: [{ spaceId: 's', spaceName: 'Main', projectId: 'p' }] }
        : [{ userData: '/profile', port: 1234 }]
    printError(f.io, new CliError(kind + '.ambiguous', 6, 'Ambiguous', undefined, details), true)
    expect(f.error().details).toEqual(details)
    expect(f.error().candidates[0]).toMatchObject({
      kind: kind === 'space' ? 'space' : 'profile',
      id: kind === 'space' ? 's' : '/profile',
    })
  },
)

it('keeps a dispatched generic API mutation non-retryable', async () => {
  const f = identityFixture(false)
  f.io.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'worker.unavailable', details: { reason: 'connection_refused' } },
      }),
    )
  expect(await run(['api', 'call', 'session.kill', '--input', '{"sessionId":"s"}'], f.io)).toBe(1)
  expect(f.error().retryable).toBe(false)
})

it.each([
  ['context.unreachable', 'connection_refused'],
  ['worker.unavailable', 'connection_refused'],
  ['transport.timeout', 'read_timeout'],
  ['agent.wait_timeout', 'wait_timeout'],
])('admits only an explicit transient reason for %s: %s', (code, reason) => {
  const f = identityFixture(false)
  printError(f.io, new CliError(code, 1, 'Arbitrary wording', undefined, { reason }), true)
  expect(f.error().retryable).toBe(true)
})
it.each([
  'context.unreachable',
  'transport.timeout',
  'agent.wait_timeout',
  'worker.unavailable',
  'terminal.runtime_not_ready',
])('denies unclassified and unknown reasons for %s', code => {
  for (const reason of [
    undefined,
    'offline',
    'unknown_reason',
    'worker_not_found',
    'endpoint_not_found',
  ]) {
    const f = identityFixture(false)
    printError(
      f.io,
      new CliError(code, 1, 'Temporarily unavailable; retry', undefined, { reason }),
      true,
    )
    expect(f.error().retryable).toBe(false)
  }
})
it.each([
  ['new.error', 'connection_refused'],
  ['worker.unavailable', 'read_timeout'],
  ['transport.timeout', 'connection_refused'],
  ['agent.prompt_stalled', 'connection_refused'],
  ['context.unreachable', 'wait_timeout'],
])('rejects reasons from a different error condition: %s / %s', (code, reason) => {
  const f = identityFixture(false)
  printError(f.io, new CliError(code, 1, 'Retry', undefined, { reason }), true)
  expect(f.error().retryable).toBe(false)
})
