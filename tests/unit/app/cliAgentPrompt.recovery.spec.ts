// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'
import type { CliIo } from '../../../src/app/cli/core/io'
import { createAppError } from '../../../src/shared/errors/appError'
import { agentPromptCommand } from '../../../src/app/cli/commands/agent'

function fixture(tty: boolean, error?: unknown) {
  let output = '',
    diagnostic = ''
  const controller = new AbortController()
  const fetch = vi.fn<typeof globalThis.fetch>(
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
                  turnId: 't',
                },
              },
        ),
      ),
  )
  const io: CliIo = {
    env: { OPENCOVE_CONTROL_URL: 'http://fake', OPENCOVE_CONTROL_TOKEN: 'test' },
    signal: controller.signal,
    fetch,
    now: Date.now,
    stdout: {
      write: text => {
        output += text
      },
    },
    stderr: {
      isTTY: tty,
      write: text => {
        diagnostic += text
      },
    },
    readStdinText: async () => 'stdin text',
    readTextFile: async () => 'file text',
  }
  return {
    io,
    controller,
    fetch,
    output: () => output,
    text: () => diagnostic,
    error: () => JSON.parse(diagnostic).error,
  }
}
const args = ['agent', 'prompt', '--node', 'n', '--text', 'hello']
afterEach(() => vi.useRealTimers())
it.each([false, true])(
  'reports every unknown post-dispatch outcome without invented flags (TTY=%s)',
  async tty => {
    const cases = [
      {
        kind: 'interrupt',
        code: 'cli.interrupted',
        exit: 130,
        message: 'Prompt delivery was interrupted. The outcome is unknown.',
      },
      {
        kind: 'envelope',
        code: 'transport.invalid_response',
        exit: 1,
        message: 'OpenCove returned an invalid delivery response. The outcome is unknown.',
      },
      {
        kind: 'value',
        code: 'transport.invalid_response',
        exit: 1,
        message: 'OpenCove returned an invalid delivery response. The outcome is unknown.',
      },
      {
        kind: 'descriptor',
        code: 'transport.invalid_response',
        exit: 1,
        message: 'OpenCove returned an invalid delivery response. The outcome is unknown.',
      },
      {
        kind: 'network',
        code: 'context.unreachable',
        exit: 3,
        message:
          'Could not obtain a delivery result from OpenCove at http://fake. The outcome is unknown.',
      },
      {
        kind: 'json',
        code: 'context.unreachable',
        exit: 3,
        message:
          'Could not obtain a delivery result from OpenCove at http://fake. The outcome is unknown.',
      },
    ]
    for (const item of cases) {
      const f = fixture(tty)
      f.fetch.mockImplementation(async () => {
        if (item.kind === 'interrupt') {
          f.controller.abort()
          throw new Error('abort')
        }
        if (item.kind === 'network') {
          throw new Error('connection lost')
        }
        if (item.kind === 'json') {
          return new Response('{')
        }
        if (item.kind === 'value') {
          return new Response(JSON.stringify({ ok: true, value: {} }))
        }
        if (item.kind === 'descriptor') {
          return new Response(JSON.stringify({ ok: false, error: {} }))
        }
        return new Response('{}')
      })
      // These are sequential invocations with independent output/signal owners.
      // eslint-disable-next-line no-await-in-loop
      expect(await run(args, f.io)).toBe(item.exit)
      expect(f.fetch).toHaveBeenCalledTimes(1)
      expect(f.text()).toContain(item.message)
      expect(f.text()).toContain('Do not resend.')
      expect(f.text()).not.toContain('Nothing was sent')
      if (tty) {
        expect(f.text()).toContain('delivery outcome: unknown.')
        expect(f.text()).not.toContain('paste attempted:')
      } else {
        expect(f.error()).toMatchObject({
          code: item.code,
          message: item.message,
          details: { deliveryOutcome: 'unknown' },
        })
        expect(f.error().details).not.toHaveProperty('pasteDispatchAttempted')
        expect(f.error().details).not.toHaveProperty('submitDispatchAttempted')
      }
    }
  },
)
it.each([false, true])('distinguishes a pre-dispatch interrupt (TTY=%s)', async tty => {
  const f = fixture(tty)
  f.controller.abort()
  expect(await run(args, f.io)).toBe(130)
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.text()).toContain('Interrupted before delivery began. Nothing was sent.')
  expect(f.text()).not.toContain('Do not resend')
  expect(f.text()).not.toContain('paste attempted:')
})
it.each([false, true])('HTTP timeout preserves unknown-outcome recovery (TTY=%s)', async tty => {
  vi.useFakeTimers()
  const f = fixture(tty)
  f.fetch.mockImplementation(
    async (_url, options) =>
      await new Promise((_resolve, reject) =>
        options?.signal?.addEventListener('abort', () => reject(new Error('timeout'))),
      ),
  )
  const result = run(args, f.io)
  await vi.advanceTimersByTimeAsync(20000)
  expect(await result).toBe(124)
  expect(f.text()).toContain('Timed out waiting for the delivery result. The outcome is unknown.')
  expect(f.text()).toContain('Do not resend.')
  if (!tty) {
    expect(f.error().details).toEqual({ deliveryOutcome: 'unknown' })
  }
})
it.each([false, true])(
  'explains known zero-write reasons without a blanket no-resend warning (TTY=%s)',
  async tty => {
    const cases = [
      ['agent.blocked', 'waiting', 'waiting for input'],
      ['agent.busy', 'working', 'still working'],
      ['agent.busy', 'delivery_in_progress', 'Another prompt delivery'],
      ['agent.state_unknown', 'readiness_unobserved', 'not observed this agent finish a turn'],
      ['agent.state_unknown', 'observation_degraded', 'cannot reliably observe'],
      ['agent.not_running', 'not_running', 'No running agent'],
      ['agent.not_running', 'caller_revoked', 'lost authorization'],
      ['agent.not_running', 'shutdown', 'stopped before delivery'],
      ['agent.not_running', 'binding_changed', 'target session changed'],
      [
        'agent.prompt_unsupported',
        'provider_unsupported',
        'local Claude Code and lifecycle-hook Codex agent windows',
      ],
      ['agent.prompt_unsupported', 'remote_unsupported', 'remote sessions'],
      ['agent.prompt_unsupported', 'terminal_agent_unsupported', 'agent windows OpenCove launched'],
      ['agent.prompt_unsupported', 'executable_override_unverified', 'custom executable path'],
      ['agent.prompt_unsupported', 'codex_hooks_notify_only', 'only notify-level coverage'],
      ['agent.prompt_unsupported', 'codex_hooks_skipped', 'skipped for daemon reuse'],
      ['agent.prompt_unsupported', 'codex_hooks_not_required', 'including Windows'],
      ['agent.prompt_unsupported', 'codex_hooks_not_installed', 'not installed'],
      ['agent.prompt_unsupported', 'codex_hooks_partial', 'incomplete'],
      ['agent.prompt_unsupported', 'codex_hooks_error', 'installation failed'],
      ['agent.prompt_unsupported', 'codex_hooks_missing', 'no explicit lifecycle'],
      ['agent.prompt_unsupported', 'codex_lifecycle_observation_missing', 'session file'],
      ['agent.prompt_unsupported', 'claude_hooks_missing', 'no explicit lifecycle'],
      ['agent.prompt_unsupported', 'bracketed_paste_off', 'has not enabled bracketed paste'],
      ['agent.prompt_timeout', 'deadline', 'timeout expired before any text'],
    ] as const
    for (const [code, reason, text] of cases) {
      const details = {
        reason,
        pasteDispatchAttempted: false,
        submitDispatchAttempted: false,
        retryable: true,
        ...(code === 'agent.blocked' ? { blockedReason: null } : {}),
      }
      const f = fixture(tty, createAppError(code, { details }).toDescriptor())
      // eslint-disable-next-line no-await-in-loop
      expect(await run(args, f.io)).toBe(code === 'agent.prompt_timeout' ? 124 : 1)
      expect(f.text()).toContain(text)
      if (reason === 'executable_override_unverified') {
        expect(f.text()).toContain('Settings → agent executable')
        expect(f.text()).toContain('cannot verify')
        expect(f.text()).toContain('Remove the override')
        expect(f.text()).toContain('launch a new agent window')
      }
      expect(f.text()).not.toContain('Do not resend')
      if (tty) {
        expect(f.text()).toContain(
          'paste attempted: no; Enter attempted: no. Nothing was sent by this call.',
        )
      } else {
        expect(f.error().details).toEqual(details)
        expect(f.error().hint).toBeTruthy()
      }
    }
  },
)
it.each([
  [' ', 'non-whitespace'],
  ['x'.repeat(32769), '32 KiB'],
  ['x\x1b', 'control character'],
  ['\ud800', 'valid Unicode'],
])('identifies the text validation rule %#', async (text, message) => {
  const f = fixture(false)
  expect(await run(['agent', 'prompt', '--node', 'n', '--text', text], f.io)).toBe(2)
  expect(f.error().message).toContain(message)
  expect(f.error().hint).toBeTruthy()
  expect(f.error().details.issues[0].path).toEqual(['text'])
  expect(f.error().details).not.toHaveProperty('pasteDispatchAttempted')
  expect(f.fetch).not.toHaveBeenCalled()
})
it.each(['61s', '0', '1.5', 'nonsense'])(
  'explains invalid timeout %s before dispatch',
  async timeout => {
    const f = fixture(false)
    expect(await run([...args, '--timeout', timeout], f.io)).toBe(2)
    expect(f.error().message).toBe(
      'The delivery timeout must be a whole number of milliseconds from 1ms to 60s.',
    )
    expect(f.fetch).not.toHaveBeenCalled()
  },
)
it('reports an unreadable prompt file before dispatch', async () => {
  const f = fixture(false)
  f.io.readTextFile = async () => {
    throw new Error('missing')
  }
  expect(await run(['agent', 'prompt', '--node', 'n', '--text-file', '/missing'], f.io)).toBe(2)
  expect(f.error().message).toBe('Could not read prompt text from /missing. Nothing was sent.')
  expect(f.fetch).not.toHaveBeenCalled()
})
it('every printed command example includes a usable text source and projection output matches', async () => {
  const commands = [...agentPromptCommand.examples!, agentPromptCommand.render!.examples![0]]
  for (const command of commands) {
    const f = fixture(false)
    const words = (command.includes('|') ? command.split('|')[1] : command)
      .trim()
      .match(/"[^"]*"|'[^']*'|\S+/g)!
      .slice(1)
      .map(word => word.replace(/^['"]|['"]$/g, ''))
    // eslint-disable-next-line no-await-in-loop
    expect(await run(words, f.io), command).toBe(0)
    expect(f.fetch).toHaveBeenCalledTimes(1)
    if (words.includes('--fields')) {
      expect(f.output()).toBe('{"deliveryId":"d"}\n')
    }
  }
})

it.each([false, true])(
  'renders structured and bare server validation without inventing attempts (TTY=%s)',
  async tty => {
    for (const details of [
      undefined,
      {
        issues: [
          {
            path: ['nodeId/sessionId'],
            message: 'Specify exactly one nonempty nodeId or sessionId. Nothing was sent.',
            hint: 'Use nodeId for a canvas agent or sessionId for a live local session.',
          },
        ],
      },
    ]) {
      const f = fixture(tty, createAppError('common.invalid_input', { details }).toDescriptor())
      // eslint-disable-next-line no-await-in-loop
      expect(await run(args, f.io)).toBe(2)
      expect(f.text()).toContain(
        details
          ? 'Specify exactly one nonempty nodeId or sessionId.'
          : 'The prompt request is invalid.',
      )
      expect(f.text()).not.toContain('paste attempted:')
      if (!tty) {
        expect(f.error().details ?? {}).not.toHaveProperty('pasteDispatchAttempted')
      }
    }
  },
)
it.each([401, 403])('authorization refusal %s is explicit and preserves exit 4', async status => {
  const f = fixture(false)
  f.fetch.mockImplementation(async () => new Response('{}', { status }))
  expect(await run(args, f.io)).toBe(4)
  expect(f.error()).toMatchObject({
    code: 'context.unauthorized',
    message: 'OpenCove refused authorization for this request.',
    hint: 'Check the endpoint and credentials before retrying.',
  })
  expect(f.error().details).toBeUndefined()
})
it('an interrupted stdin read reports zero dispatch and unrelated commands keep their interruption text', async () => {
  const f = fixture(false)
  f.io.readStdinText = async () => {
    throw new (await import('../../../src/app/cli/core/errors')).CliError(
      'cli.interrupted',
      130,
      'Interrupted',
    )
  }
  expect(await run(['agent', 'prompt', '--node', 'n', '--text-file', '-'], f.io)).toBe(130)
  expect(f.error().message).toBe('Interrupted before delivery began. Nothing was sent.')
  expect(f.fetch).not.toHaveBeenCalled()
  const g = fixture(false)
  g.controller.abort()
  expect(await run(['ping'], g.io)).toBe(130)
  expect(g.error().message).toBe('Interrupted')
})
