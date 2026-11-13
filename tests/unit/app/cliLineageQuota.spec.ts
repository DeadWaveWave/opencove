// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { agentSpawnErrorPresentation } from '../../../src/shared/errors/agentSpawnError'
import { identityFixture, who, node } from './cliIdentity.helpers'

const quota = { depth: 1, maxDepth: 3, liveInTree: 4, maxLiveInTree: 6 }
it.each(['whoami', 'context'])(
  '%s projects the Worker quota without recomputing it',
  async command => {
    const f = identityFixture()
    f.values['system.whoami'] = { ...who, lineageQuota: quota, token: 'never-print' }
    const prefix = command === 'context' ? 'self.' : ''
    expect(
      await run(
        [command, '--fields', `${prefix}lineageQuota.depth,${prefix}lineageQuota.liveInTree`],
        f.io,
      ),
    ).toBe(0)
    expect(JSON.parse(f.out())).toEqual(
      command === 'context'
        ? { self: { lineageQuota: { depth: 1, liveInTree: 4 } } }
        : { lineageQuota: { depth: 1, liveInTree: 4 } },
    )
    expect(f.out()).not.toContain('never-print')
  },
)
it.each(['whoami', 'context'])(
  '%s omits quota from older Workers even with --fields',
  async command => {
    const f = identityFixture()
    const prefix = command === 'context' ? 'self.' : ''
    expect(await run([command, '--fields', `${prefix}nodeId,${prefix}lineageQuota`], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual(
      command === 'context' ? { self: { nodeId: who.nodeId } } : { nodeId: who.nodeId },
    )
  },
)

it.each(['agent.spawn_depth_limit', 'agent.spawn_concurrency_limit'])(
  '%s preserves the exit and provides named stop hints on human stderr',
  async code => {
    const f = identityFixture(),
      original = f.io.fetch
    let stderr = ''
    f.io.stderr = {
      isTTY: true,
      write: value => {
        stderr += value
      },
    }
    const nodes = [
      { nodeId: 'delegate', title: 'Reviewer', kind: 'agent', depth: 2, state: 'running' },
    ]
    f.io.fetch = async (url, init) =>
      JSON.parse(String(init?.body)).id === 'node.create'
        ? new Response(JSON.stringify({ ok: false, error: { code, details: { nodes } } }))
        : original(url, init)
    expect(
      await run(
        [
          'api',
          'call',
          'node.create',
          '--input',
          JSON.stringify({ kind: 'terminal', projectId: who.projectId, data: {} }),
        ],
        f.io,
      ),
    ).toBe(1)
    expect(stderr).toContain(code)
    expect(stderr).toContain('Reviewer')
    expect(stderr).toContain('opencove agent stop --node delegate')
  },
)
it('keeps identity quota projections restricted to the public fields', async () => {
  const f = identityFixture()
  f.values['system.whoami'] = { ...who, lineageQuota: { ...quota, token: 'never-print' } }
  expect(await run(['whoami', '-o', 'json'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).lineageQuota).toEqual(quota)
  expect(f.out()).not.toContain('never-print')
})

it('can follow the terminal recovery hint without dispatching agent-only stop', async () => {
  const f = identityFixture()
  f.values['node.get'] = { node: { ...node, sessionId: 'plain-shell' } }
  f.values['agent.get'] = null
  const { hint } = agentSpawnErrorPresentation({
    code: 'agent.spawn_concurrency_limit',
    details: {
      nodes: [{ nodeId: node.id, title: 'Shell', kind: 'terminal', depth: 2, state: 'running' }],
    },
  })!
  const get = /opencove node get --node [\w-]+ --fields sessionId/.exec(hint)![0]
  expect(await run(get.split(' ').slice(1), f.io)).toBe(0)
  const sessionId = JSON.parse(f.out()).node.sessionId
  expect(sessionId).toBe('plain-shell')
  const kill = /opencove session kill --session <sessionId>/
    .exec(hint)![0]
    .replace('<sessionId>', sessionId)
  expect(await run(kill.split(' ').slice(1), f.io)).toBe(0)
  expect(f.requests.at(-1)).toMatchObject({ id: 'session.kill', payload: { sessionId } })
  expect(f.requests.some(r => r.id === 'session.stopNode' || r.id === 'agent.get')).toBe(false)
})

it('shell-quotes structured recovery actions with the same agent target as the hint', async () => {
  const { spawnRecoveryAction } = await import('../../../src/shared/errors/agentSpawnError')
  const occupant = {
    nodeId: "agent'; echo unsafe",
    title: 'Quoted',
    kind: 'agent',
    depth: 2,
    state: 'running' as const,
  }
  const action = spawnRecoveryAction(occupant)!
  expect(action.kind).toBe('stop_agent')
  expect(action.command).toBe("opencove agent stop --node 'agent'\\''; echo unsafe'")
  expect(
    agentSpawnErrorPresentation({
      code: 'agent.spawn_concurrency_limit',
      details: { nodes: [occupant] },
    })!.hint,
  ).toContain(action.command)
  expect(
    spawnRecoveryAction({ ...occupant, kind: 'terminal', sessionId: "session'; echo unsafe" })!
      .command,
  ).toBe("opencove session kill --session 'session'\\''; echo unsafe'")
  expect(spawnRecoveryAction({ ...occupant, kind: 'terminal' })).toBeUndefined()
})
