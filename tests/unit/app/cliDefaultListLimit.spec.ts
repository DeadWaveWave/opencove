// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'

function fixture() {
  const f = identityFixture(false)
  const nodes = Array.from({ length: 120 }, (_, i) => ({
    ...node,
    id: `node-${i}`,
    title: `Shell ${i}`,
  }))
  f.values['node.list'] = { nodes }
  f.values['agent.list'] = {
    epoch: 'e',
    seq: 1,
    agents: nodes.map(n => ({ nodeId: n.id, sessionId: n.id, state: 'idle' })),
  }
  let stderr = ''
  f.io.stderr.write = text => {
    stderr += text
  }
  return { ...f, nodes, stderr: () => stderr }
}
it.each(['node', 'agent'])(
  'caps %s list after querying, with totals and one notice',
  async group => {
    const f = fixture()
    expect(await run([group, 'list'], f.io)).toBe(0)
    const value = JSON.parse(f.out())
    expect(value[group === 'node' ? 'nodes' : 'agents']).toHaveLength(50)
    expect(value).toMatchObject({ truncated: true, total: 120 })
    expect(f.stderr().trim().split('\n')).toHaveLength(1)
    expect(f.stderr()).toContain('70 omitted')
    expect(f.stderr()).toContain('--full')
  },
)
it.each(
  [['--full'], ['--limit', '0'], ['--limit', '120'], ['--full', '--limit', '3']].map(flags => ({
    flags,
  })),
)('honors explicit output controls: $flags', async ({ flags }) => {
  const f = fixture()
  expect(await run(['node', 'list', ...flags], f.io)).toBe(0)
  const count = flags.includes('3') ? 3 : 120
  expect(JSON.parse(f.out()).nodes).toHaveLength(count)
})
it.each(
  [
    ['--fields', 'id'],
    ['-o', 'table'],
  ].map(flags => ({ flags })),
)('caps projected output too: $flags', async ({ flags }) => {
  const f = fixture()
  expect(await run(['node', 'list', ...flags], f.io)).toBe(0)
  if (flags.includes('table')) {
    expect(f.out().trim().split('\n')).toHaveLength(51)
  } else {
    expect(JSON.parse(f.out()).nodes).toEqual(f.nodes.slice(0, 50).map(n => ({ id: n.id })))
  }
  expect(f.stderr()).toContain('70 omitted')
})
it('does not cap internal selector resolution', async () => {
  const f = fixture()
  f.values['node.get'] = { node: f.nodes[119] }
  expect(await run(['node', 'get', '--node', 'Shell 119'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).node.id).toBe('node-119')
  expect(f.stderr()).toBe('')
})
it('keeps context neighbors complete', async () => {
  const f = fixture()
  expect(await run(['context', '--project', 'project-123456'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).nodes).toHaveLength(120)
})
