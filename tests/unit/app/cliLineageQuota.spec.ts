// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, who } from './cliIdentity.helpers'

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
    expect(stderr).toContain("opencove agent stop --node 'delegate'")
  },
)
it('keeps identity quota projections restricted to the public fields', async () => {
  const f = identityFixture()
  f.values['system.whoami'] = { ...who, lineageQuota: { ...quota, token: 'never-print' } }
  expect(await run(['whoami'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).lineageQuota).toEqual(quota)
  expect(f.out()).not.toContain('never-print')
})
