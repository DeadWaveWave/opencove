// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node, project, who } from './cliIdentity.helpers'

it.each([true, false])('creates on the explicit root canvas (inside=%s)', async inside => {
  const f = identityFixture(inside)
  const args = ['node', 'create', 'note', '--root-canvas', '--text', 'hi']
  if (!inside) {
    args.push('--project', 'Project')
  }
  expect(await run(args, f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'node.create')?.payload).toEqual({
    kind: 'note',
    projectId: project.id,
    data: { text: 'hi' },
  })
  expect(f.requests.some(r => r.id === 'node.get' || r.id === 'space.get')).toBe(false)
})

it('allows an explicit root project to override the caller project', async () => {
  const f = identityFixture()
  f.values['project.list'] = { projects: [{ ...project, id: 'other-project', name: 'Other' }] }
  expect(await run(['node', 'create', 'note', '--root-canvas', '--project', 'Other'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'node.create')?.payload).toMatchObject({
    projectId: 'other-project',
  })
})

it('rejects root creation outside OpenCove without a project before requests', async () => {
  const f = identityFixture(false)
  expect(await run(['node', 'create', 'note', '--root-canvas'], f.io)).toBe(2)
  expect(f.error().message).toBe(
    '--root-canvas needs a project outside OpenCove: add --project <id>',
  )
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each(['create', 'list'])(
  '%s rejects every root/Space locator conflict before requests',
  async action => {
    for (const flag of ['space', 'space-name', 'worker', 'branch', 'path']) {
      const f = identityFixture()
      const args = [
        'node',
        action,
        ...(action === 'create' ? ['note'] : []),
        '--root-canvas',
        `--${flag}`,
        'target',
      ]
      // eslint-disable-next-line no-await-in-loop
      expect(await run(args, f.io)).toBe(2)
      expect(f.error().message).toContain(`Cannot use --root-canvas and --${flag} together`)
      expect(f.fetch).not.toHaveBeenCalled()
    }
  },
)

it.each([
  [who.spaceId, null],
  [null, who.spaceId],
  ['moved-space', who.spaceId],
  [null, null],
])('uses current container %s rather than spawn container %s', async (current, spawned) => {
  const f = identityFixture()
  f.io.env.OPENCOVE_SPACE_ID = spawned ?? ''
  f.values['node.get'] = { node: { ...node, spaceId: current } }
  expect(await run(['node', 'create', 'note'], f.io)).toBe(0)
  expect(f.requests[0]).toMatchObject({ id: 'node.get', payload: { nodeId: who.nodeId } })
  const payload = f.requests.find(r => r.id === 'node.create')!.payload
  if (current) {
    expect(payload.space).toEqual({ kind: 'spaceId', spaceId: current })
  } else {
    expect(payload).not.toHaveProperty('space')
    expect(payload.projectId).toBe(project.id)
  }
})

it.each(['create', 'list'])('%s never treats a failed caller lookup as root', async action => {
  const f = identityFixture()
  f.io.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'node.not_found', debugMessage: 'Caller was deleted' },
        }),
      ),
  )
  expect(await run(['node', action, ...(action === 'create' ? ['note'] : [])], f.io)).toBe(1)
  expect(f.io.fetch).toHaveBeenCalledTimes(1)
  expect(f.error().code).toBe('node.not_found')
})

it('suggests root creation for a project-only target without connecting', async () => {
  const f = identityFixture()
  expect(await run(['node', 'create', 'note', '--project', 'Project'], f.io)).toBe(2)
  expect(JSON.stringify(f.error())).toContain('--root-canvas')
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each([null, 'current-space'])('lists the current container %s', async current => {
  const f = identityFixture()
  f.values['node.get'] = { node: { ...node, spaceId: current } }
  expect(await run(['node', 'list'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'node.list')?.payload).toEqual({
    projectId: project.id,
    ...(current ? { space: { kind: 'spaceId', spaceId: current } } : {}),
  })
})

it('filters root nodes before list limits and preserves the output envelope', async () => {
  const f = identityFixture()
  f.values['node.list'] = {
    projectId: project.id,
    nodes: [
      { ...node, kind: 'note', id: 'in-space' },
      { ...node, kind: 'note', id: 'root-one', spaceId: null },
      { ...node, kind: 'note', id: 'root-two', spaceId: null },
    ],
  }
  expect(await run(['node', 'list', '--root-canvas', '--limit', '1'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({
    projectId: project.id,
    nodes: [{ id: 'root-one', spaceId: null }],
    truncated: { nodes: 2 },
  })
  expect(f.requests.find(r => r.id === 'node.list')?.payload).toEqual({ projectId: project.id })
})

it('never treats a mismatched caller node response as root', async () => {
  const f = identityFixture()
  f.values['node.get'] = { node: { ...node, id: 'other-node', spaceId: null } }
  expect(await run(['node', 'create', 'note'], f.io)).toBe(1)
  expect(f.error().code).toBe('node.not_found')
  expect(f.requests.map(r => r.id)).toEqual(['node.get'])
})

it('reads the current container when identity must fall back to the session grant', async () => {
  const f = identityFixture()
  delete f.io.env.OPENCOVE_NODE_ID
  f.values['node.get'] = { node: { ...node, spaceId: null } }
  expect(await run(['node', 'create', 'note'], f.io)).toBe(0)
  expect(f.requests.map(r => r.id)).toEqual(['system.whoami', 'node.get', 'node.create'])
})

it.each(['note', 'task', 'website', 'terminal', 'agent'])(
  'supports root creation for %s',
  async kind => {
    const f = identityFixture()
    const extra =
      kind === 'task'
        ? ['--requirement', 'Review']
        : kind === 'website'
          ? ['--url', 'https://example.com']
          : []
    expect(await run(['node', 'create', kind, '--root-canvas', ...extra], f.io)).toBe(0)
    expect(f.requests.find(r => r.id === 'node.create')?.payload).toMatchObject({
      kind,
      projectId: project.id,
    })
  },
)

it('canvas skill topic explains root creation and project-wide lists outside Spaces', async () => {
  const f = identityFixture(false)
  expect(await run(['skill', 'canvas'], f.io)).toBe(0)
  expect(f.out().replace(/\s+/g, ' ')).toContain(
    'To put a node on the canvas outside any Space: `opencove node create note --root-canvas --text …`',
  )
  expect(f.out().replace(/\s+/g, ' ')).toContain('`node list` lists the whole project')
})

it('lists root nodes in an explicitly selected project outside OpenCove', async () => {
  const f = identityFixture(false)
  f.values['node.list'] = {
    projectId: project.id,
    nodes: [{ ...node, kind: 'note', spaceId: null }],
  }
  expect(
    await run(['node', 'list', '--root-canvas', '--project', 'Project', '--kind', 'note'], f.io),
  ).toBe(0)
  expect(f.requests.find(r => r.id === 'node.list')?.payload).toEqual({
    projectId: project.id,
    kind: 'note',
  })
  expect(JSON.parse(f.out()).nodes).toHaveLength(1)
  expect(f.requests.some(r => r.id === 'node.get')).toBe(false)
})

it('explains project-wide list defaults outside Spaces in offline help', async () => {
  const f = identityFixture(false)
  expect(await run(['node', 'list', '--help'], f.io)).toBe(0)
  expect(f.out()).toContain(
    'Outside every Space, list all nodes in your project; use --root-canvas to list only root nodes',
  )
  expect(f.fetch).not.toHaveBeenCalled()
})

it('documents supported ways to reveal root nodes without a root Space focus flag', () => {
  const guide = readFileSync('docs/cli/CANVAS_NODE_CONTROL.md', 'utf8')
  const focusSpace = guide.split('\n').find(line => line.startsWith('opencove canvas focus space'))!
  expect(focusSpace).not.toContain('--root-canvas')
  expect(guide).toContain('canvas focus node --node <id>')
  expect(guide).toContain('`--focus`')
})
