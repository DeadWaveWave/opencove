// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node, space } from './cliIdentity.helpers'

it.each(['note', 'task', 'website', 'agent', 'terminal'])(
  'prints only the created %s ID',
  async kind => {
    const f = identityFixture(false)
    const extra =
      kind === 'task'
        ? ['--requirement', 'Review']
        : kind === 'website'
          ? ['--url', 'https://example.com']
          : []
    expect(await run(['node', 'create', kind, '--space', space.id, '-q', ...extra], f.io)).toBe(0)
    expect(f.out()).toBe(node.id + '\n')
  },
)
it('uses the worktree path as its identifier', async () => {
  const f = identityFixture(false)
  f.values['worktree.create'] = { spaceId: space.id, worktree: { path: '/repo/worktree' } }
  expect(
    await run(['worktree', 'create', '--space', space.id, '--name', 'review', '-q'], f.io),
  ).toBe(0)
  expect(f.out()).toBe('/repo/worktree\n')
})
it.each(
  [
    ['--fields', 'id'],
    ['-o', 'json'],
    ['-o', 'table'],
  ].map(flags => ({ flags })),
)('refuses quiet conflicts before IO: $flags', async ({ flags }) => {
  const f = identityFixture(false)
  expect(await run(['node', 'create', 'note', '--space', space.id, '-q', ...flags], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.out()).toBe('')
})

it('keeps quiet errors on stderr with empty stdout', async () => {
  const f = identityFixture(false)
  const original = f.io.fetch!
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'node.create'
      ? new Response(JSON.stringify({ ok: false, error: { code: 'common.forbidden' } }))
      : original(url, init)
  expect(await run(['node', 'create', 'note', '--space', space.id, '--quiet'], f.io)).toBe(4)
  expect(f.out()).toBe('')
  expect(f.error().retryable).toBe(false)
})
