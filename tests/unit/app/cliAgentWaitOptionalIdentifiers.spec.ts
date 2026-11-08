// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import { CliError } from '../../../src/app/cli/core/errors'
import { IDENTIFIER_LOOKUP_BUDGET_MS } from '../../../src/app/cli/core/agentWaitEvidence'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerAgentRunStateHandlers } from '../../../src/app/main/controlSurface/handlers/agentRunStateHandlers'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

function endedUnbound(readScope = false) {
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 10,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  registry.register({ sessionId: 's', incarnation: 'i', provider: 'codex' })
  registry.observe('s', {
    incarnation: 'i',
    source: 'codex_hook',
    sourceSequence: 1,
    observedAt: 1,
    state: 'working',
    boundary: { kind: 'start', evidence: 'prompt_submit' },
  })
  registry.observe('s', {
    incarnation: 'i',
    source: 'codex_hook',
    sourceSequence: 2,
    observedAt: 2,
    state: 'idle',
    boundary: { kind: 'end', outcome: 'completed' },
  })
  registry.bind('s', { nodeId: 'n' })
  const surface = createControlSurface()
  registerAgentRunStateHandlers(surface, { agentRuns: { registry } } as PtyStreamHub)
  const query = vi.fn(async (id: string, payload: unknown) => {
    const result = await surface.invoke(
      {
        now: () => new Date(),
        ...(readScope ? { requestAuth: { kind: 'session-grant', grant: { tier: 'read' } } } : {}),
      } as ControlSurfaceContext,
      {
        kind: 'query',
        id,
        payload,
      },
    )
    if (!result.ok) {
      throw new CliError(result.error.code, 1, 'Unavailable', undefined, result.error.details)
    }
    return result.value
  })
  const wait = () =>
    waitForAgents({
      nodeIds: ['n'],
      turnId: 't',
      any: false,
      timeoutMs: 500,
      query,
      fetch: vi.fn() as never,
      connection: { endpoint: 'http://fake', token: 't' },
    })
  return { registry, query, wait }
}
const mainResult = {
  nodeId: 'n',
  sessionId: 's',
  turnId: 't',
  outcome: 'completed',
  endedAt: 2,
  state: 'idle',
  persisted: false,
  memoryOnlyReason: 'unavailable',
}
it('optional wait identifiers: an unbound end then binding still succeeds with archive disabled', async () => {
  const f = endedUnbound()
  expect(await f.query('agent.list', {})).not.toHaveProperty('turnIdentifiers')
  expect(f.registry.get({ nodeId: 'n' })?.lastEndedTurn?.id).toBe('t')
  await expect(f.wait()).resolves.toEqual(mainResult)
})
it.each([
  'auth.forbidden',
  'common.forbidden',
  'unavailable',
  'turn_not_found',
  'archive_unavailable',
  'unsupported',
  'generic',
])('optional wait identifiers: %s never changes snapshot completion or exit status', async code => {
  const f = endedUnbound(),
    original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) => {
    if (id === 'agent.finalMessage') {
      if (code === 'generic') {
        throw new Error('offline')
      }
      throw new CliError(code, code.includes('forbidden') ? 4 : 1, 'Unavailable')
    }
    return original(id, payload)
  })
  await expect(f.wait()).resolves.toEqual(mainResult)
  expect(
    f.query.mock.calls.filter(([id]) => id === 'agent.finalMessage').map(call => call.slice(0, 2)),
  ).toEqual([['agent.finalMessage', { nodeId: 'n', turnId: 't' }]])
})
it('optional wait identifiers: one successful enrichment copies only IDs after matching session/turn', async () => {
  const f = endedUnbound(),
    original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) =>
    id === 'agent.finalMessage'
      ? {
          nodeId: 'n',
          sessionId: 's',
          turnId: 't',
          deliveryIds: ['d'],
          promptIds: ['p'],
          outcome: 'failed',
          endedAt: 999,
          persisted: true,
          message: 'private',
        }
      : original(id, payload),
  )
  await expect(f.wait()).resolves.toEqual({ ...mainResult, deliveryIds: ['d'], promptIds: ['p'] })
})
it('optional wait identifiers: displaced session metadata is ignored', async () => {
  const f = endedUnbound(),
    original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) =>
    id === 'agent.finalMessage'
      ? { nodeId: 'n', sessionId: 'other', turnId: 't', deliveryIds: ['wrong'] }
      : original(id, payload),
  )
  await expect(f.wait()).resolves.toEqual(mainResult)
})

it('optional wait identifiers: real read-scope authorization cannot invalidate an established end', async () => {
  const f = endedUnbound(true)
  await expect(f.wait()).resolves.toEqual(mainResult)
  expect(f.query.mock.calls.filter(([id]) => id === 'agent.finalMessage')).toHaveLength(1)
  await expect(f.query('agent.finalMessage', { nodeId: 'n', turnId: 't' })).rejects.toMatchObject({
    code: 'common.forbidden',
  })
})

it('optional wait identifiers: a message-free end keeps the identifiers its error details carry', async () => {
  const f = endedUnbound(),
    original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) => {
    if (id === 'agent.finalMessage') {
      throw new CliError('agent.final_message_unavailable', 1, 'No message', undefined, {
        reason: 'provider_sent_no_message',
        nodeId: 'n',
        sessionId: 's',
        turnId: 't',
        outcome: 'failed',
        deliveryIds: ['retained-delivery'],
        promptIds: ['p'],
      })
    }
    return original(id, payload)
  })
  await expect(f.wait()).resolves.toEqual({
    ...mainResult,
    deliveryIds: ['retained-delivery'],
    promptIds: ['p'],
  })
})

it('optional wait identifiers: a stalled lookup is cut off after its own short budget', async () => {
  const f = endedUnbound(),
    original = f.query.getMockImplementation()!
  let lookupSignal: AbortSignal | undefined
  f.query.mockImplementation(async (id, payload, signal?: AbortSignal) => {
    if (id === 'agent.finalMessage') {
      lookupSignal = signal
      return new Promise(() => {})
    }
    return original(id, payload)
  })
  const started = Date.now()
  await expect(
    waitForAgents({
      nodeIds: ['n'],
      turnId: 't',
      any: false,
      timeoutMs: 20_000,
      query: f.query,
      fetch: vi.fn() as never,
      connection: { endpoint: 'http://fake', token: 't' },
    }),
  ).resolves.toEqual(mainResult)
  expect(Date.now() - started).toBeLessThan(IDENTIFIER_LOOKUP_BUDGET_MS + 1_000)
  // The wait's cleanup cancels the abandoned lookup.
  expect(lookupSignal?.aborted).toBe(true)
})
