// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { agentFinalMessageOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/agent'
import { identityFixture, node, who } from './cliIdentity.helpers'

function fixture(state: string, blockedReason: string | null = null) {
  const f = identityFixture()
  f.values['agent.get'] = {
    nodeId: node.id,
    sessionId: who.sessionId,
    state,
    blockedReason,
    turn: { id: 'turn-live' },
  }
  const original = f.io.fetch
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'agent.finalMessage'
      ? new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'agent.final_message_unavailable',
              details: { reason: 'turn_not_ended', sessionId: who.sessionId },
            },
          }),
        )
      : original(url, init)
  return f
}
const args = ['agent', 'read', '--node', node.id, '--turn', 'turn-live']
it.each(['permission', 'question', 'plan', null])(
  'explains a waiting turn (%s) with human recovery',
  async reason => {
    const f = fixture('waiting', reason)
    expect(await run(args, f.io)).toBe(1)
    const error = f.error()
    expect(error).toMatchObject({
      code: 'agent.final_message_unavailable',
      details: {
        reason: 'turn_not_ended',
        state: 'waiting',
        blockedReason: reason,
        nodeId: node.id,
        sessionId: who.sessionId,
        turnId: 'turn-live',
      },
    })
    expect(error.message).toContain('waiting for the user')
    if (reason) {
      expect(error.message).toContain(reason)
    }
    expect(error.hint).toContain('Ask the user to resolve it in OpenCove')
    expect(f.out()).toBe('')
  },
)
it('reports a working target and retains the exact wait command', async () => {
  const f = fixture('working')
  expect(await run(args, f.io)).toBe(1)
  expect(f.error()).toMatchObject({
    details: { state: 'working' },
    hint: expect.stringContaining(`opencove agent wait --node ${node.id} --turn turn-live`),
  })
})
it.each(['missing', 'failed', 'replacement', 'turn_changed'])(
  'preserves the original turn error if state is %s',
  async condition => {
    const f = fixture('waiting', 'permission')
    if (condition === 'turn_changed') {
      f.values['agent.get'] = {
        nodeId: node.id,
        sessionId: who.sessionId,
        state: 'waiting',
        blockedReason: 'permission',
        turn: { id: 'new-turn' },
      }
    }
    if (condition === 'missing') {
      f.values['agent.get'] = null
    }
    if (condition === 'replacement') {
      f.values['agent.get'] = {
        nodeId: node.id,
        sessionId: 'replacement',
        state: 'waiting',
        blockedReason: 'permission',
      }
    }
    if (condition === 'failed') {
      const original = f.io.fetch
      f.io.fetch = async (url, init) =>
        JSON.parse(String(init?.body)).id === 'agent.get'
          ? new Response(JSON.stringify({ ok: false, error: { code: 'common.unexpected' } }))
          : original(url, init)
    }
    expect(await run(args, f.io)).toBe(1)
    expect(f.error()).toMatchObject({
      code: 'agent.final_message_unavailable',
      details: { reason: 'turn_not_ended', state: 'unknown' },
      hint: expect.stringContaining('agent wait'),
    })
    expect(f.error().message).not.toContain('waiting for the user')
  },
)

it('enriches the actual Worker reason-only error with the matching current session', async () => {
  const f = identityFixture()
  f.values['agent.get'] = {
    nodeId: node.id,
    sessionId: who.sessionId,
    state: 'waiting',
    blockedReason: 'permission',
    turn: { id: 'turn-live' },
  }
  const original = f.io.fetch
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'agent.finalMessage'
      ? new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'agent.final_message_unavailable',
              details: { reason: 'turn_not_ended' },
            },
          }),
        )
      : original(url, init)
  expect(await run(args, f.io)).toBe(1)
  expect(f.error()).toMatchObject({
    details: {
      reason: 'turn_not_ended',
      sessionId: who.sessionId,
      state: 'waiting',
      blockedReason: 'permission',
    },
  })
})

it('returns interruption exit 130 when aborted during the enrichment request', async () => {
  const f = fixture('working')
  const controller = new AbortController()
  f.io.signal = controller.signal
  let enrichmentStarted!: () => void
  const started = new Promise<void>(resolve => {
    enrichmentStarted = resolve
  })
  const original = f.io.fetch
  const requests: string[] = []
  f.io.fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body))
    requests.push(request.id)
    if (request.id !== 'agent.get') {
      return original(url, init)
    }
    const signal = init?.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    return new Promise<Response>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      enrichmentStarted()
    })
  }
  const pending = run(args, f.io)
  await started
  controller.abort()
  expect(await pending).toBe(130)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({ code: 'cli.interrupted', message: 'Interrupted' })
  expect(requests.filter(id => id === 'agent.finalMessage' || id === 'agent.get')).toEqual([
    'agent.finalMessage',
    'agent.get',
  ])
})

it.each(
  [' turn-live ', '\tturn-live\n'].flatMap(turn =>
    ['waiting', 'working'].map(state => ({ turn, state })),
  ),
)(
  'normalizes the Worker-accepted turn ID before sending and presenting ($state, $turn)',
  async ({ turn, state }) => {
    const expected = agentFinalMessageOperation.input.parse({ nodeId: node.id, turnId: turn })
    expect(expected).toEqual({ nodeId: node.id, turnId: 'turn-live' })
    const f = fixture(state, state === 'waiting' ? 'permission' : null)
    const original = f.io.fetch
    let sent: unknown
    f.io.fetch = async (url, init) => {
      const request = JSON.parse(String(init?.body))
      if (request.id === 'agent.finalMessage') {
        sent = request.payload
      }
      return original(url, init)
    }
    expect(await run(['agent', 'read', '--node', node.id, '--turn', turn], f.io)).toBe(1)
    expect(sent).toEqual(expected)
    const error = f.error()
    expect(error.details).toMatchObject({ reason: 'turn_not_ended', turnId: 'turn-live', state })
    expect(error.message).toContain('Turn turn-live')
    if (state === 'waiting') {
      expect(error.details.blockedReason).toBe('permission')
      expect(error.message).toContain('waiting for the user')
      expect(error.hint).toContain('Ask the user to resolve it in OpenCove')
    } else {
      expect(error.hint).toContain(`opencove agent wait --node ${node.id} --turn turn-live`)
    }
  },
)

it('rejects a whitespace-only turn ID consistently with the Worker schema before connecting', async () => {
  const turn = ' \t\n '
  expect(
    agentFinalMessageOperation.input.safeParse({ nodeId: node.id, turnId: turn }).success,
  ).toBe(false)
  const f = fixture('waiting', 'permission')
  expect(await run(['agent', 'read', '--node', node.id, '--turn', turn], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.out()).toBe('')
})
