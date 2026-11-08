import { createAppError } from '../../../src/shared/errors/appError'
// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'
import type { CliIo } from '../../../src/app/cli/core/io'
function fixture(error?: unknown, result: Record<string, unknown> = {}) {
  let out = '',
    err = ''
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          error
            ? { ok: false, error }
            : {
                ok: true,
                value: {
                  deliveryId: 'd',
                  nodeId: 'n',
                  sessionId: 's',
                  phase: 'submission_observed',
                  textComparison: 'unavailable',
                  turnId: 'turn',
                  ...result,
                },
              },
        ),
      ),
  )
  const io: CliIo = {
    stdout: {
      write: text => {
        out += text
      },
    },
    stderr: {
      write: text => {
        err += text
      },
    },
    env: { OPENCOVE_CONTROL_URL: 'http://fake', OPENCOVE_CONTROL_TOKEN: 'fake' },
    fetch,
    now: Date.now,
    readTextFile: vi.fn(async () => 'one\ntwo'),
    readStdinText: vi.fn(async () => 'stdin\ntext'),
  }
  return { io, fetch, rawError: () => err, out: () => out, err: () => JSON.parse(err).error }
}
it.each([
  ['--text', 'literal'],
  ['--text-file', '/tmp/prompt'],
  ['--text-file', '-'],
])('dispatches %s %s with a server deadline', async (flag, value) => {
  const f = fixture()
  expect(await run(['agent', 'prompt', '--node', 'n', flag, value, '--timeout', '20s'], f.io)).toBe(
    0,
  )
  const body = JSON.parse(f.fetch.mock.calls[0][1].body as string)
  expect(body).toMatchObject({
    kind: 'command',
    id: 'agent.prompt',
    payload: { nodeId: 'n', timeoutMs: 20000 },
  })
  expect(f.out()).toContain('submission_observed')
})
it.each([{ flags: [] }, { flags: ['--text', 'x', '--text-file', '-'] }])(
  'refuses missing or conflicting text before dispatch',
  async ({ flags }) => {
    const f = fixture()
    expect(await run(['agent', 'prompt', '--node', 'n', ...flags], f.io)).toBe(2)
    expect(f.fetch).not.toHaveBeenCalled()
  },
)
it.each([
  ['agent.blocked', 'waiting', 1],
  ['agent.prompt_timeout', 'deadline', 124],
  ['agent.prompt_stalled', 'deadline', 124],
  ['agent.prompt_stalled', 'receipt_deadline', 1],
])('preserves %s dispatch flags and maps deadline exits', async (code, reason, exit) => {
  const details = {
    reason,
    pasteDispatchAttempted: true,
    submitDispatchAttempted: true,
    retryable: false,
  }
  const f = fixture({ code, details })
  expect(await run(['agent', 'prompt', '--node', 'n', '--text', 'hello'], f.io)).toBe(exit)
  expect(f.err().details).toEqual(details)
})
it('documents promise and non-guarantees in help', async () => {
  const f = fixture()
  expect(await run(['agent', 'prompt', '--help'], f.io)).toBe(0)
  expect(f.out()).toContain('does not prove the model read exactly this text')
  expect(f.out()).toContain('Do not resend a prompt that may already have been submitted')
  expect(f.out()).toContain('docs/agent/PROMPT_DELIVERY.md')
  expect(f.out()).toMatchSnapshot()
})

it.each([
  [
    'agent.prompt_interrupted',
    false,
    'Prompt delivery stopped after a paste attempt. Text may be in the editor; this command did not press Enter.',
  ],
  [
    'agent.prompt_stalled',
    true,
    'OpenCove attempted to press Enter but did not observe a matching submission event.',
  ],
] as const)(
  'renders exact recovery text for %s in TTY and JSON',
  async (code, submitted, message) => {
    const details = {
      reason: 'test',
      pasteDispatchAttempted: true,
      submitDispatchAttempted: submitted,
      retryable: false,
    }
    const error = createAppError(code, { details }).toDescriptor()
    const json = fixture(error)
    expect(await run(['agent', 'prompt', '--node', 'n', '--text', 'hello'], json.io)).toBe(1)
    const hint = submitted
      ? 'Do not resend. Inspect "opencove agent read --node <selector> --screen" and the conversation to determine whether the prompt was submitted.'
      : 'Inspect the editor with "opencove agent read --node <selector> --screen" and have the human resolve any dialog before continuing. Do not paste the text again if it is already there.'
    expect(json.err()).toEqual({ code, message, hint, details })
    const tty = fixture(error)
    tty.io.stderr.isTTY = true
    expect(await run(['agent', 'prompt', '--node', 'n', '--text', 'hello'], tty.io)).toBe(1)
    expect(tty.rawError()).toBe(
      `error[${code}]: ${message}\n  paste attempted: yes; Enter attempted: ${submitted ? 'yes' : 'no'}. ${submitted ? 'Submission is unconfirmed.' : 'Text may be in the editor.'}\n  hint: ${hint}\n`,
    )
  },
)

it.each([false, true])(
  'different remains success with an stderr notice even with field selection (TTY=%s)',
  async tty => {
    const f = fixture(undefined, {
      textComparison: 'different',
      comparisonProfile: 'claude-code-v1',
      promptId: 'provider-id',
    })
    f.io.stdout.isTTY = tty
    f.io.stderr.isTTY = tty
    expect(
      await run(
        ['agent', 'prompt', '--node', 'n', '--text', 'hello', '--fields', 'deliveryId'],
        f.io,
      ),
    ).toBe(0)
    expect(f.out()).toContain('d')
    expect(f.rawError()).toBe(
      'Claude Code reported a submitted prompt whose text differs from what you sent — an existing draft may have been included. Do not resend; check the agent with `opencove agent read --node n --screen`.\n',
    )
    expect(f.fetch).toHaveBeenCalledTimes(1)
  },
)
it.each(['matched', 'unavailable'])(
  'prints %s without a notice and exposes declared evidence fields',
  async textComparison => {
    const f = fixture(undefined, {
      textComparison,
      comparisonProfile: 'claude-code-v1',
      promptId: 'provider-id',
    })
    expect(
      await run(
        [
          'agent',
          'prompt',
          '--node',
          'n',
          '--text',
          'hello',
          '--fields',
          'textComparison,comparisonProfile,promptId',
        ],
        f.io,
      ),
    ).toBe(0)
    expect(JSON.parse(f.out())).toEqual({
      textComparison,
      comparisonProfile: 'claude-code-v1',
      promptId: 'provider-id',
    })
    expect(f.rawError()).toBe('')
  },
)

it.each([false, true])(
  'explains terminal prompt refusal and agent-window recovery (TTY=%s)',
  async tty => {
    const details = {
      reason: 'terminal_agent_unsupported',
      pasteDispatchAttempted: false,
      submitDispatchAttempted: false,
    }
    const f = fixture(createAppError('agent.prompt_unsupported', { details }).toDescriptor())
    f.io.stderr.isTTY = tty
    expect(await run(['agent', 'prompt', '--node', 'n', '--text', 'hello'], f.io)).toBe(1)
    expect(f.out()).toBe('')
    expect(f.rawError()).toContain('shell would receive the input after the agent stops')
    expect(f.rawError()).toContain('lead agent other agents report to')
    expect(f.rawError()).toContain('Run Agent on a task')
    expect(f.rawError()).toContain('opencove node create agent --space <space> --prompt <text>')
    expect(f.rawError()).toContain('can still use the opencove CLI')
    if (!tty) {
      expect(f.err().details).toEqual(details)
    }
  },
)
