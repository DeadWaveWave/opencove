// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, project, space, who } from './cliIdentity.helpers'

function fixture(inSpace = true) {
  const f = identityFixture()
  delete f.io.env.OPENCOVE_NODE_ID
  f.io.env.OPENCOVE_SPACE_ID = inSpace ? space.id : ''
  f.values['system.whoami'] = { ...who, nodeId: null, spaceId: inSpace ? space.id : '' }
  return f
}
it('reports a session grant without a canvas node in whoami', async () => {
  const f = fixture()
  expect(await run(['whoami'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({
    caller: 'session-grant',
    scope: 'interact',
    nodeId: null,
    projectId: project.id,
    spaceId: space.id,
  })
})
it.each([true, false])(
  'reports nodeId and self.node as null in context (space=%s)',
  async inSpace => {
    const f = fixture(inSpace)
    expect(await run(['context'], f.io)).toBe(0)
    expect(JSON.parse(f.out()).self).toMatchObject({
      caller: 'session-grant',
      nodeId: null,
      node: null,
    })
    expect(f.requests.some(r => r.id === 'node.get')).toBe(false)
  },
)
it.each(
  [
    ['node', 'get', '--node', '@self'],
    ['agent', 'read', '--node', '@self', '--screen'],
    ['node', 'list'],
    ['node', 'create', 'note', '--text', 'Progress'],
  ].map(args => ({ args })),
)('names explicit node and Space options for node-less defaults: $args', async ({ args }) => {
  const f = fixture()
  expect(await run(args, f.io)).toBe(2)
  expect(f.error().message).toContain('not bound to a canvas node')
  expect(f.error().hint).toContain('--node')
  expect(f.error().hint).toContain('--space')
  expect(f.requests.every(r => r.id === 'system.whoami')).toBe(true)
})
it('names --space when a standalone project session has no Space', async () => {
  const f = fixture(false)
  expect(await run(['space', 'get', '--space', '@self'], f.io)).toBe(2)
  expect(f.error().message).toContain('no Space')
  expect(f.error().hint).toContain('--space')
})
it('keeps explicit Space targets available without node identity', async () => {
  const f = fixture()
  expect(await run(['node', 'list', '--space', '@self'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'node.list')?.payload).toMatchObject({
    space: { kind: 'spaceId', spaceId: space.id },
  })
})
