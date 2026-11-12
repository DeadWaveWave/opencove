// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { sendAgentPrompt } from '../../../src/app/cli/core/agentPromptRequest'
import { CliError } from '../../../src/app/cli/core/errors'
import type { CommandContext } from '../../../src/app/cli/core/command'
function fixture(supported: boolean, failure?: CliError) {
  let err = ''
  const invoke = vi.fn(async (id, payload) => {
    if (id === 'system.operation.describe') {
      return { inputSchema: { properties: supported ? { whenBusy: {} } : {} } }
    }
    if (failure) {
      throw failure
    }
    return { deliveryId: payload.deliveryId ?? 'old-worker', phase: 'submission_observed' }
  })
  const ctx = {
    input: { nodeId: 'n', text: 'prompt', timeoutMs: 15000 },
    options: {},
    invoke,
    io: {
      stderr: {
        write: (s: string) => {
          err += s
        },
      },
    },
  } as unknown as CommandContext
  return { ctx, invoke, err: () => err }
}
it('older Worker receives no whenBusy or deliveryId and preserves idle success', async () => {
  const f = fixture(false)
  await expect(sendAgentPrompt(f.ctx)).resolves.toMatchObject({ deliveryId: 'old-worker' })
  expect(f.invoke.mock.calls[1][1]).toEqual(f.ctx.input)
  expect(f.err()).toContain('cannot steer')
})
it('older Worker busy refusal remains visible without retries', async () => {
  const failure = new CliError('agent.busy', 1, 'working')
  const f = fixture(false, failure)
  await expect(sendAgentPrompt(f.ctx)).rejects.toBe(failure)
  expect(f.invoke).toHaveBeenCalledTimes(2)
})
it('negotiated steering sends a caller UUID and prints it before a lost response', async () => {
  const failure = new CliError('transport.unreachable', 1, 'lost response')
  const f = fixture(true, failure)
  await expect(sendAgentPrompt(f.ctx)).rejects.toBe(failure)
  const payload = f.invoke.mock.calls[1][1]
  expect(payload).toMatchObject({
    whenBusy: 'steer',
    deliveryId: expect.stringMatching(/^[a-f0-9-]{36}$/),
  })
  expect(failure.details).toMatchObject({ deliveryId: payload.deliveryId })
  expect(f.err()).toContain(payload.deliveryId)
  expect(f.invoke).toHaveBeenCalledTimes(2)
})
it('explicit refuse is negotiated and unsettled locator is preserved', async () => {
  const failure = new CliError('agent.delivery_unsettled', 1, 'unsettled', undefined, {
    deliveryId: 'previous',
  })
  const f = fixture(true, failure)
  f.ctx.options['if-busy'] = 'refuse'
  await expect(sendAgentPrompt(f.ctx)).rejects.toBe(failure)
  expect(f.invoke.mock.calls[1][1]).toMatchObject({ whenBusy: 'refuse' })
  expect(failure.details).toMatchObject({ deliveryId: 'previous' })
})

it.each([
  new CliError(
    'common.invalid_input',
    2,
    'Invalid input for system.operation.describe: Unknown control surface query: system.operation.describe',
  ),
  new CliError('common.invalid_input', 2, 'Unknown operation: system.operation.describe'),
  new CliError('common.unavailable', 1, 'Operation unavailable: system.operation.describe'),
  new CliError('common.unavailable', 1, 'Unavailable', undefined, {
    operationId: 'system.operation.describe',
    reason: 'operation_unavailable',
  }),
])('recognized unavailable describe falls back to one legacy mutation (%#)', async error => {
  const f = fixture(false)
  f.invoke.mockImplementation(async id => {
    if (id === 'system.operation.describe') {
      throw error
    }
    return { deliveryId: 'old-worker', phase: 'submission_observed' }
  })
  await expect(sendAgentPrompt(f.ctx)).resolves.toMatchObject({ deliveryId: 'old-worker' })
  expect(f.invoke).toHaveBeenCalledTimes(2)
  expect(f.invoke.mock.calls[1]).toEqual(['agent.prompt', f.ctx.input])
})
it.each([
  'common.forbidden',
  'cli.interrupted',
  'transport.unreachable',
  'common.invalid_input',
  'common.unavailable',
])('unrelated describe error %s does not permit any mutation', async code => {
  const f = fixture(false)
  const error = new CliError(code, 1, 'unrelated failure')
  f.invoke.mockRejectedValue(error)
  await expect(sendAgentPrompt(f.ctx)).rejects.toBe(error)
  expect(f.invoke).toHaveBeenCalledTimes(1)
})
it('expect-turn is sent only when that guard is described', async () => {
  const f = fixture(true)
  f.ctx.input = { ...(f.ctx.input as object), expectTurnId: 'turn' }
  f.invoke.mockImplementation(async id =>
    id === 'system.operation.describe'
      ? { inputSchema: { properties: { whenBusy: {}, expectTurnId: {} } } }
      : { phase: 'dispatched' },
  )
  await sendAgentPrompt(f.ctx)
  expect(f.invoke.mock.calls[1][1]).toMatchObject({ whenBusy: 'steer', expectTurnId: 'turn' })
})
it.each([true, false])(
  'expect-turn refuses before mutation when guard support is missing (whenBusy=%s)',
  async support => {
    const f = fixture(support)
    f.ctx.input = { ...(f.ctx.input as object), expectTurnId: 'turn' }
    await expect(sendAgentPrompt(f.ctx)).rejects.toMatchObject({ code: 'cli.unsupported' })
    expect(f.invoke).toHaveBeenCalledTimes(1)
  },
)
