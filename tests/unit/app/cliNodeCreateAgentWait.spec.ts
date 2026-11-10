// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { waitForCreatedAgent } from '../../../src/app/cli/commands/nodeCreateAgentWait'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import { CliError } from '../../../src/app/cli/core/errors'
import type { CommandContext } from '../../../src/app/cli/core/command'
import type { CreateNodeResult } from '../../../src/shared/contracts/dto/nodeControl'
import { snapshot } from './cliAgentWait.helpers'
vi.mock('../../../src/app/cli/core/agentWait', () => ({ waitForAgents: vi.fn() }))

function fixture() {
  const controller = new AbortController()
  const state = {
    ...snapshot('n'),
    sessionId: 's',
    turn: { id: 't', startedAt: 2, start: 'observed' },
  }
  const invoke = vi.fn(
    async (id: string): Promise<unknown> =>
      id === 'agent.get'
        ? state
        : {
            nodeId: 'n',
            sessionId: 's',
            turnId: 't',
            outcome: 'completed',
            message: 'Reply',
            source: 'hook',
            persisted: true,
            truncated: false,
          },
  )
  const ctx = {
    options: { wait: true, read: true },
    input: {},
    io: { now: Date.now, signal: controller.signal, stderr: { write: vi.fn() } },
    invoke,
    connection: { endpoint: 'http://fake', token: 'secret' },
  } as unknown as CommandContext
  const created = {
    revision: 2,
    projectId: 'p',
    spaceId: null,
    node: { id: 'n', sessionId: 's', data: { kind: 'agent', provider: 'claude-code' } },
  } as CreateNodeResult
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
    created,
    state,
    invoke,
    controller,
    execute: (budget = 1000) => waitForCreatedAgent(ctx, created, Date.now() + budget),
  }
}
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
it('ignores another session and uses fresh session-addressed observations', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.invoke.mockResolvedValueOnce({
    ...f.state,
    sessionId: 'other',
    turn: { id: 'wrong', startedAt: 1, start: 'observed' },
  })
  const pending = f.execute()
  await vi.advanceTimersByTimeAsync(1)
  expect(waitForAgents).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  await expect(pending).resolves.toMatchObject({ turnId: 't', reply: { message: 'Reply' } })
  expect(f.invoke).toHaveBeenNthCalledWith(
    1,
    'agent.get',
    { sessionId: 's' },
    { fresh: true, signal: expect.any(AbortSignal) },
  )
  expect(vi.mocked(waitForAgents).mock.calls[0][0].timeoutMs).toBeLessThan(1000)
  expect(vi.getTimerCount()).toBe(0)
})
it('uses a retained initial end before an active newer turn', async () => {
  const f = fixture()
  f.invoke.mockResolvedValueOnce({
    ...f.state,
    turn: { ...f.state.turn, id: 'newer' },
    lastEndedTurn: { id: 't', outcome: 'completed', endedAt: 10 },
  })
  await expect(f.execute()).resolves.toMatchObject({ turnId: 't' })
  expect(waitForAgents).toHaveBeenCalledWith(expect.objectContaining({ turnId: 't' }))
})
it.each(['completed', 'failed', 'aborted', 'unknown'] as const)(
  'returns ended %s as exit-zero data',
  async outcome => {
    const f = fixture()
    vi.mocked(waitForAgents).mockResolvedValue({
      nodeId: 'n',
      sessionId: 's',
      turnId: 't',
      outcome,
      persisted: false,
      state: 'idle',
    })
    await expect(f.execute()).resolves.toMatchObject({ revision: 2, node: { id: 'n' }, outcome })
  },
)
it.each([
  ['agent.wait_attention', 10],
  ['agent.wait_exited', 11],
  ['agent.wait_timeout', 124],
  ['cli.interrupted', 130],
] as const)('preserves %s with concrete continuation and IDs', async (code, exitCode) => {
  const f = fixture()
  vi.mocked(waitForAgents).mockRejectedValue(
    new CliError(code, exitCode, 'Stopped', undefined, {
      targets: [{ blockedSummary: { kind: 'plan' } }],
    }),
  )
  await expect(f.execute()).rejects.toMatchObject({
    code,
    exitCode,
    details: {
      nodeId: 'n',
      sessionId: 's',
      turnId: 't',
      targets: [{ blockedSummary: { kind: 'plan' } }],
    },
    hint: expect.stringContaining('opencove agent wait --node n --turn t'),
  })
  expect(f.invoke.mock.calls.filter(c => c[0] === 'agent.get')).toHaveLength(1)
})
it.each(['identification', 'completion', 'reading'])(
  'retains IDs after an unexpected failure during %s',
  async phase => {
    const f = fixture()
    if (phase === 'identification') {
      f.invoke.mockRejectedValueOnce(new Error('offline'))
    }
    if (phase === 'completion') {
      vi.mocked(waitForAgents).mockRejectedValue(new Error('offline'))
    }
    if (phase === 'reading') {
      f.invoke.mockResolvedValueOnce(f.state).mockRejectedValueOnce(new Error('offline'))
    }
    await expect(f.execute()).rejects.toMatchObject({
      code: 'cli.failed',
      details: {
        nodeId: 'n',
        sessionId: 's',
        ...(phase === 'identification' ? {} : { turnId: 't' }),
      },
      hint: expect.stringContaining('Do not repeat node create agent'),
    })
  },
)
it.each(['completion', 'reading'])('does not accept another session during %s', async phase => {
  const f = fixture()
  if (phase === 'completion') {
    vi.mocked(waitForAgents).mockResolvedValue({
      nodeId: 'n',
      sessionId: 'other',
      turnId: 't',
      outcome: 'completed',
      persisted: true,
      state: 'idle',
    })
  } else {
    f.invoke
      .mockResolvedValueOnce(f.state)
      .mockResolvedValueOnce({ sessionId: 'other', turnId: 't', message: 'Wrong' })
  }
  if (phase === 'completion') {
    await expect(f.execute()).rejects.toMatchObject({
      code: 'transport.invalid_response',
      details: { nodeId: 'n', sessionId: 's', turnId: 't' },
    })
  } else {
    await expect(f.execute()).resolves.toMatchObject({
      reply: null,
      replyUnavailableReason: 'transport.invalid_response',
    })
  }
})
it('missing reply does not fail an ended turn', async () => {
  const f = fixture()
  f.invoke.mockResolvedValueOnce(f.state).mockRejectedValueOnce(
    new CliError('agent.final_message_unavailable', 1, 'Missing', undefined, {
      reason: 'provider_sent_no_message',
    }),
  )
  await expect(f.execute()).resolves.toMatchObject({
    outcome: 'completed',
    reply: null,
    replyUnavailableReason: 'provider_sent_no_message',
  })
})
it('without --read, never fetches reply content', async () => {
  const f = fixture()
  f.ctx.options.read = false
  await expect(f.execute()).resolves.not.toHaveProperty('reply')
  expect(f.invoke.mock.calls.map(c => c[0])).toEqual(['agent.get'])
})
it('refuses unsupported providers after creation with a typed error', async () => {
  const f = fixture()
  f.created.node.data = {
    ...f.created.node.data,
    provider: 'gemini',
  } as CreateNodeResult['node']['data']
  await expect(f.execute()).rejects.toMatchObject({
    code: 'agent.wait_unsupported',
    details: { nodeId: 'n', sessionId: 's', reason: 'provider_unsupported' },
    hint: expect.stringContaining('was created'),
  })
  expect(f.invoke).not.toHaveBeenCalled()
})
it('returns exit 11 when the new session exits without a turn', async () => {
  const f = fixture()
  f.invoke.mockResolvedValueOnce({ ...f.state, state: 'exited', turn: null })
  await expect(f.execute()).rejects.toMatchObject({
    exitCode: 11,
    details: { nodeId: 'n', sessionId: 's' },
  })
})
it('identification aborts an in-flight query at the deadline and cleans timers', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.invoke.mockImplementation(
    (_id, _payload, options) =>
      new Promise((_, reject) =>
        options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        }),
      ),
  )
  const pending = expect(f.execute()).rejects.toMatchObject({
    exitCode: 124,
    details: { nodeId: 'n', sessionId: 's' },
  })
  await vi.advanceTimersByTimeAsync(1000)
  await pending
  expect(vi.getTimerCount()).toBe(0)
})
it.each(['before', 'during'])('cleans identification on interruption %s observing', async phase => {
  vi.useFakeTimers()
  const f = fixture()
  f.invoke.mockResolvedValue(null)
  if (phase === 'before') {
    f.controller.abort()
  }
  const pending = expect(f.execute()).rejects.toMatchObject({
    exitCode: 130,
    details: { nodeId: 'n', sessionId: 's' },
  })
  await vi.advanceTimersByTimeAsync(1)
  f.controller.abort()
  await pending
  expect(vi.getTimerCount()).toBe(0)
})
it('keeps IDs when a created node has no session', async () => {
  const f = fixture()
  f.created.node.sessionId = null
  await expect(f.execute()).rejects.toMatchObject({
    code: 'transport.invalid_response',
    details: { nodeId: 'n', sessionId: null },
  })
})
it('ignores a non-null binding to a different node on the created session', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.invoke.mockResolvedValueOnce({ ...f.state, nodeId: 'other-node' })
  const pending = f.execute()
  await vi.advanceTimersByTimeAsync(1)
  expect(waitForAgents).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  await expect(pending).resolves.toMatchObject({ turnId: 't' })
})
