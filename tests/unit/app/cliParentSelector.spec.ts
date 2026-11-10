// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { resolveSelectors } from '../../../src/app/cli/core/selectors'
import { defineCommand } from '../../../src/app/cli/core/command'
import type { CliIo } from '../../../src/app/cli/core/io'
const command = defineCommand({
  path: ['node', 'get'],
  summary: 'Get a node',
  connect: true,
  options: { node: { type: 'string', description: 'Node' } },
})
const io = { env: { OPENCOVE_ENV: '1', OPENCOVE_NODE_ID: 'child' } } as unknown as CliIo
it('resolves @parent on the Worker before looking up a literal name', async () => {
  const invoke = vi.fn(async (id: string) => {
    if (id === 'system.capabilities') {
      return { features: { nodeLineageV1: true } }
    }
    if (id === 'node.resolveCallerSelector') {
      return { kind: 'node', id: 'parent', callerNodeId: 'child' }
    }
    throw Error(id)
  })
  const args = { positionals: [], options: { node: '@parent' } }
  await resolveSelectors(command, args, io, invoke)
  expect(args.options.node).toBe('parent')
  expect(invoke).toHaveBeenCalledWith('node.resolveCallerSelector', {
    selector: '@parent',
    expectedCallerNodeId: 'child',
  })
})
it.each([{}, { nodeLineageV1: false }])(
  'refuses old Workers without name fallback (%j)',
  async features => {
    const invoke = vi.fn(async () => ({ features }))
    await expect(
      resolveSelectors(command, { positionals: [], options: { node: '@parent' } }, io, invoke),
    ).rejects.toMatchObject({ code: 'cli.unsupported', exitCode: 5 })
    expect(invoke).toHaveBeenCalledTimes(1)
  },
)

it('keeps the @self whoami fallback when injected node identity is hidden', async () => {
  const invoke = vi.fn(async () => ({ kind: 'session-grant', nodeId: 'recovered' }))
  const args = { positionals: [], options: { node: '@self' } }
  await resolveSelectors(command, args, { env: {} } as CliIo, invoke)
  expect(args.options.node).toBe('recovered')
  expect(invoke).toHaveBeenCalledExactlyOnceWith('system.whoami', {})
})

it.each(['node', 'agent'])('keeps %s creator filtering project-wide', async domain => {
  const { identityFixture, who } = await import('./cliIdentity.helpers')
  const { run } = await import('../../../src/app/cli/core/run')
  const f = identityFixture()
  f.values['system.capabilities'] = { features: { nodeLineageV1: true } }
  expect(
    await run(
      [domain, 'list', '--spawned-by', '@self', '--fields', domain === 'node' ? 'id' : 'nodeId'],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.find(r => r.id === `${domain}.list`)?.payload).toMatchObject({
    spawnedByNodeId: who.nodeId,
    projectId: who.projectId,
  })
  expect(f.requests.find(r => r.id === `${domain}.list`)?.payload).not.toHaveProperty(
    domain === 'node' ? 'space' : 'spaceId',
  )
})

it.each(['space', 'project'])('preserves explicit %s constraints for @parent', async filter => {
  const { identityFixture, who } = await import('./cliIdentity.helpers')
  const { run } = await import('../../../src/app/cli/core/run')
  const f = identityFixture()
  f.values['node.resolveCallerSelector'] = { id: 'parent', kind: 'node', callerNodeId: who.nodeId }
  f.values['node.get'] = {
    node: { id: 'parent', projectId: 'other-project', spaceId: 'other-space' },
  }
  expect(
    await run(
      [
        'node',
        'delete',
        '--node',
        '@parent',
        `--${filter}`,
        filter === 'space' ? who.spaceId : who.projectId,
      ],
      f.io,
    ),
  ).toBe(1)
  expect(f.error().code).toBe('node.not_found')
  expect(f.requests.some(r => r.id === 'node.delete')).toBe(false)
})

it.each(['node', 'agent'])('refuses --spawned-by on old Workers before %s list', async domain => {
  const { identityFixture } = await import('./cliIdentity.helpers')
  const { run } = await import('../../../src/app/cli/core/run')
  const f = identityFixture()
  f.values['system.capabilities'] = { features: {} }
  expect(await run([domain, 'list', '--spawned-by', '@self'], f.io)).toBe(5)
  expect(f.requests.map(r => r.id)).toEqual(['system.capabilities'])
})

it('never falls back to a literal @parent name after a Worker refusal', async () => {
  const { CliError } = await import('../../../src/app/cli/core/errors')
  const invoke = vi.fn(async (id: string) => {
    if (id === 'system.capabilities') {
      return { features: { nodeLineageV1: true } }
    }
    throw new CliError(
      'node.parent_unavailable',
      1,
      'The parent node has been deleted.',
      undefined,
      { reason: 'parent_deleted' },
    )
  })
  await expect(
    resolveSelectors(command, { positionals: [], options: { node: '@parent' } }, io, invoke),
  ).rejects.toMatchObject({ details: { reason: 'parent_deleted' } })
  expect(invoke.mock.calls.map(([id]) => id)).toEqual([
    'system.capabilities',
    'node.resolveCallerSelector',
  ])
})
