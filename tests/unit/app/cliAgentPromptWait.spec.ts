// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { agentPromptCommand } from '../../../src/app/cli/commands/agent'
import type { CommandContext } from '../../../src/app/cli/core/command'
import { CliError } from '../../../src/app/cli/core/errors'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
vi.mock('../../../src/app/cli/core/agentWait', () => ({ waitForAgents: vi.fn() }))

const receipt = {
  deliveryId: 'd',
  nodeId: 'n',
  sessionId: 's',
  turnId: 't',
  phase: 'submission_observed',
  textComparison: 'matched',
  comparisonProfile: 'claude-code-v1',
}
function fixture(phase = 'submission_observed') {
  let stderr = ''
  const controller = new AbortController()
  const invoke = vi.fn(async (id, payload, options): Promise<unknown> => {
    if (id === 'system.operation.describe') {
      return { inputSchema: { properties: { whenBusy: {} } } }
    }
    if (id === 'agent.prompt') {
      return { ...receipt, phase }
    }
    if (id === 'agent.delivery.get') {
      return {
        ...receipt,
        available: true,
        status: 'submitted',
        epoch: 'e',
        incarnation: 'i',
        mode: 'turn',
        evidenceWindow: 'closed',
        createdAt: 1,
      }
    }
    if (id === 'agent.finalMessage') {
      return {
        nodeId: 'n',
        sessionId: 's',
        turnId: 't',
        message: 'Reply',
        source: 'hook',
        persisted: true,
        outcome: 'completed',
        truncated: false,
      }
    }
    throw new Error(`Unexpected ${id}: ${JSON.stringify({ payload, options })}`)
  })
  const ctx = {
    options: { wait: true, read: true, timeout: 1000, node: 'n' },
    positionals: [],
    input: { nodeId: 'n', text: 'hello', timeoutMs: 15000 },
    io: {
      now: Date.now,
      signal: controller.signal,
      stderr: {
        write: (s: string) => {
          stderr += s
        },
      },
    },
    invoke,
    whoami: async () => ({ kind: 'bearer' }),
    connection: { endpoint: 'http://fake', token: 'secret' },
  } as unknown as CommandContext
  vi.mocked(waitForAgents).mockResolvedValue({
    nodeId: 'n',
    sessionId: 's',
    turnId: 't',
    outcome: 'completed',
    endedAt: 10,
    persisted: true,
    state: 'idle',
  })
  return {
    ctx,
    invoke,
    controller,
    stderr: () => stderr,
    execute: () => agentPromptCommand.execute!(ctx),
  }
}
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
it('confirms before exact waiting and reads the bound reply in one result', async () => {
  const f = fixture()
  await expect(f.execute()).resolves.toMatchObject({
    ...receipt,
    outcome: 'completed',
    endedAt: 10,
    reply: { message: 'Reply' },
  })
  expect(f.invoke.mock.calls.filter(c => c[0] === 'agent.prompt')).toHaveLength(1)
  expect(waitForAgents).toHaveBeenCalledWith(
    expect.objectContaining({ turnId: 't', nodeIds: ['n'] }),
  )
  expect(f.invoke.mock.calls.find(c => c[0] === 'agent.finalMessage')![1]).toEqual({
    sessionId: 's',
    turnId: 't',
  })
})
it('does not read without --read and does not compose without --wait', async () => {
  const f = fixture()
  delete f.ctx.options.read
  await expect(f.execute()).resolves.not.toHaveProperty('reply')
  delete f.ctx.options.wait
  await expect(f.execute()).resolves.toEqual(receipt)
  expect(waitForAgents).toHaveBeenCalledTimes(1)
})
it.each(['not_sent', 'ambiguous', 'unknown', 'unavailable'])(
  'stops unconfirmed %s before turn waiting',
  async status => {
    const f = fixture('dispatched')
    const original = f.invoke.getMockImplementation()!
    f.invoke.mockImplementation(async (id, payload, opts) =>
      id === 'agent.delivery.get'
        ? status === 'unavailable'
          ? { available: false, deliveryId: 'd', reason: 'unavailable' }
          : { ...((await original(id, payload, opts)) as object), status }
        : original(id, payload, opts),
    )
    await expect(f.execute()).rejects.toMatchObject({
      exitCode: 1,
      details: { deliveryId: 'd', turnId: 't' },
    })
    expect(waitForAgents).not.toHaveBeenCalled()
  },
)
it('waits for Codex dispatched confirmation before waiting on its working turn', async () => {
  vi.useFakeTimers()
  const f = fixture('dispatched')
  const original = f.invoke.getMockImplementation()!
  let polls = 0
  f.invoke.mockImplementation(async (id, payload, opts) => ({
    ...((await original(id, payload, opts)) as object),
    ...(id === 'agent.delivery.get'
      ? { status: ++polls === 1 ? 'dispatched' : 'submitted', mode: 'steer' }
      : {}),
  }))
  const pending = f.execute()
  await vi.advanceTimersByTimeAsync(1)
  expect(waitForAgents).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(250)
  await expect(pending).resolves.toMatchObject({ turnId: 't', outcome: 'completed' })
  expect(vi.mocked(waitForAgents).mock.calls[0][0].timeoutMs).toBeLessThan(1000)
})
it.each([
  ['agent.wait_attention', 10],
  ['agent.wait_exited', 11],
  ['agent.wait_timeout', 124],
  ['cli.interrupted', 130],
] as const)('preserves %s and its envelope plus recovery IDs', async (code, exitCode) => {
  const f = fixture()
  const details = { targets: [{ nodeId: 'n', blockedSummary: 'Permission needed' }] }
  vi.mocked(waitForAgents).mockRejectedValue(
    new CliError(code, exitCode, 'Stopped', undefined, details),
  )
  await expect(f.execute()).rejects.toMatchObject({
    code,
    exitCode,
    details: { ...details, deliveryId: 'd', turnId: 't' },
  })
  expect(f.stderr()).toContain('t')
})
it('missing exact reply does not fail an ended turn', async () => {
  const f = fixture()
  const original = f.invoke.getMockImplementation()!
  f.invoke.mockImplementation(async (id, p, o) => {
    if (id === 'agent.finalMessage') {
      throw new CliError('agent.final_message_unavailable', 1, 'No reply', undefined, {
        reason: 'provider_sent_no_message',
      })
    }
    return original(id, p, o)
  })
  await expect(f.execute()).resolves.toMatchObject({
    outcome: 'completed',
    reply: null,
    replyUnavailableReason: 'provider_sent_no_message',
  })
})
it('interruption during confirmation carries IDs and cleans its timer', async () => {
  vi.useFakeTimers()
  const f = fixture('dispatched')
  const original = f.invoke.getMockImplementation()!
  f.invoke.mockImplementation(async (id, p, o) => ({
    ...((await original(id, p, o)) as object),
    ...(id === 'agent.delivery.get' ? { status: 'dispatched' } : {}),
  }))
  const pending = f.execute()
  const rejected = expect(pending).rejects.toMatchObject({
    exitCode: 130,
    details: { deliveryId: 'd', turnId: 't' },
  })
  await vi.advanceTimersByTimeAsync(1)
  f.controller.abort()
  await rejected
  expect(waitForAgents).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('confirmation timeout shares the budget, keeps IDs and never starts turn waiting', async () => {
  vi.useFakeTimers()
  const f = fixture('dispatched')
  const original = f.invoke.getMockImplementation()!
  f.invoke.mockImplementation(async (id, p, o) => ({
    ...((await original(id, p, o)) as object),
    ...(id === 'agent.delivery.get' ? { status: 'dispatched' } : {}),
  }))
  const rejected = expect(f.execute()).rejects.toMatchObject({
    exitCode: 124,
    details: { deliveryId: 'd', turnId: 't', lastKnown: { status: 'dispatched' } },
  })
  await vi.advanceTimersByTimeAsync(1000)
  await rejected
  expect(waitForAgents).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it.each(['agent.blocked', 'agent.prompt_stalled', 'transport.unreachable'])(
  'preserves sending failure %s without confirmation or waiting',
  async code => {
    const f = fixture()
    const original = f.invoke.getMockImplementation()!
    f.invoke.mockImplementation(async (id, p, o) => {
      if (id === 'agent.prompt') {
        throw new CliError(code, 1, 'Failed', 'Never resend.', { turnId: 't' })
      }
      return original(id, p, o)
    })
    await expect(f.execute()).rejects.toMatchObject({
      code,
      exitCode: 1,
      details: { turnId: 't', deliveryId: expect.any(String) },
    })
    expect(f.invoke.mock.calls.map(c => c[0])).toEqual([
      'system.operation.describe',
      'agent.prompt',
    ])
    expect(waitForAgents).not.toHaveBeenCalled()
  },
)
it.each(['confirmation', 'completion', 'reply'])(
  'never accepts a different session from %s',
  async phase => {
    const f = fixture()
    const original = f.invoke.getMockImplementation()!
    const operation = phase === 'confirmation' ? 'agent.delivery.get' : 'agent.finalMessage'
    if (phase === 'completion') {
      vi.mocked(waitForAgents).mockResolvedValue({
        nodeId: 'n',
        sessionId: 'replacement',
        turnId: 't',
        outcome: 'completed',
        persisted: true,
        state: 'idle',
      })
    } else {
      f.invoke.mockImplementation(async (id, p, o) => ({
        ...((await original(id, p, o)) as object),
        ...(id === operation ? { sessionId: 'replacement' } : {}),
      }))
    }
    if (phase === 'reply') {
      await expect(f.execute()).resolves.toMatchObject({
        reply: null,
        replyUnavailableReason: 'transport.invalid_response',
      })
    } else {
      await expect(f.execute()).rejects.toMatchObject({
        code: 'transport.invalid_response',
        details: { sessionId: 's', deliveryId: 'd', turnId: 't' },
      })
    }
  },
)
it.each(['completed', 'failed', 'aborted', 'unknown'] as const)(
  'returns an ended %s outcome without inventing task success',
  async outcome => {
    const f = fixture()
    vi.mocked(waitForAgents).mockResolvedValue({
      nodeId: 'n',
      sessionId: 's',
      turnId: 't',
      outcome,
      persisted: true,
      state: 'idle',
    })
    await expect(f.execute()).resolves.toMatchObject({ outcome })
  },
)
it('reply interruption remains exit 130 after a completed turn, retaining recovery IDs', async () => {
  const f = fixture()
  const original = f.invoke.getMockImplementation()!
  f.invoke.mockImplementation(async (id, p, o) => {
    if (id === 'agent.finalMessage') {
      throw new CliError('cli.interrupted', 130, 'Interrupted')
    }
    return original(id, p, o)
  })
  await expect(f.execute()).rejects.toMatchObject({
    exitCode: 130,
    details: { deliveryId: 'd', turnId: 't' },
  })
})
it('resolves confirmation identity before sending, so its lookup cannot escape the wait budget', async () => {
  const f = fixture()
  f.ctx.whoami = vi.fn(async () => {
    throw new CliError('context.unreachable', 3, 'Identity unavailable')
  })
  await expect(f.execute()).rejects.toMatchObject({ code: 'context.unreachable' })
  expect(f.invoke).not.toHaveBeenCalled()
})
