// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, who, project } from './cliIdentity.helpers'
import { parseCommand } from '../../../src/app/cli/core/args'
import { commands } from '../../../src/app/cli/commands'

const otherProject = { id: 'project-other', name: 'Other', path: '/other' }
const ownNode = { id: 'abcdef-own', kind: 'task', title: 'Todo', projectId: project.id }
const otherNode = { ...ownNode, id: 'abcdef-other', projectId: otherProject.id }

function tokenOnly(admin = false) {
  const f = identityFixture()
  f.io.env = { OPENCOVE_CONTROL_URL: 'http://fixture', OPENCOVE_CONTROL_TOKEN: 'secret' }
  f.io.fetch = vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    f.requests.push(request)
    let value: unknown
    if (request.id === 'system.whoami') {
      value = admin ? { kind: 'bearer', scopeTier: 'admin' } : who
    } else if (request.id === 'project.list') {
      value = { projects: [project, otherProject] }
    } else if (request.id === 'node.list') {
      // The active project is B, while this session belongs to A.
      value = { nodes: [request.payload.projectId === project.id ? ownNode : otherNode] }
    } else if (request.id === 'node.get') {
      return new Response(JSON.stringify({ ok: false, error: { code: 'node.not_found' } }))
    } else if (request.id === 'node.delete') {
      value = { nodeId: request.payload.nodeId }
    } else {
      throw new Error(`Unexpected operation: ${request.id}`)
    }
    return new Response(JSON.stringify({ ok: true, value }))
  })
  return f
}

it.each(['Todo', 'abcdef'])(
  'scopes a token-only mutation to its authenticated project: %s',
  async selector => {
    const f = tokenOnly()
    expect(await run(['node', 'delete', '--node', selector], f.io)).toBe(0)
    expect(f.requests.find(request => request.id === 'node.list')?.payload).toEqual({
      projectId: project.id,
    })
    expect(f.requests.at(-1)).toMatchObject({ id: 'node.delete', payload: { nodeId: ownNode.id } })
    expect(f.requests.filter(request => request.id === 'system.whoami')).toHaveLength(1)
    expect(f.requests.filter(request => request.id === 'node.list')).toHaveLength(1)
  },
)

it('retains explicit project overrides for a token-only mutation', async () => {
  const f = tokenOnly()
  expect(await run(['node', 'delete', '--node', 'Todo', '--project', 'Other'], f.io)).toBe(0)
  expect(f.requests.at(-1)).toMatchObject({ id: 'node.delete', payload: { nodeId: otherNode.id } })
  expect(f.requests.some(request => request.id === 'system.whoami')).toBe(false)
})

it('preserves the active-project fallback for an authenticated desktop caller', async () => {
  const f = tokenOnly(true)
  expect(await run(['node', 'delete', '--node', 'Todo'], f.io)).toBe(0)
  expect(f.requests.at(-1)).toMatchObject({ id: 'node.delete', payload: { nodeId: otherNode.id } })
})

it('never lists or mutates after identity lookup is denied', async () => {
  const f = tokenOnly()
  const transport = f.io.fetch
  f.io.fetch = vi.fn(async (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'system.whoami') {
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'control_surface.unauthorized' } }),
        { status: 401 },
      )
    }
    return transport(url, init)
  })
  expect(await run(['node', 'delete', '--node', 'Todo'], f.io)).toBe(4)
  expect(f.requests).toEqual([])
})

it.each([false, true])('quotes all executable @self examples (ungrouped=%s)', async ungrouped => {
  const f = identityFixture()
  if (ungrouped) {
    f.io.env.OPENCOVE_SPACE_ID = ''
    f.values['system.whoami'] = { ...who, spaceId: '' }
  }
  expect(await run(['context'], f.io)).toBe(0)
  const next: string[] = JSON.parse(f.out()).next
  expect(next.join('\n')).toContain('"@self"')
  expect(next.join('\n')).not.toMatch(/--(?:node|space|project) @self\b/)
  const help = identityFixture()
  expect(await run(['context', '--help'], help.io)).toBe(0)
  expect(help.out()).toContain('--space "@self"')
  expect(help.out()).not.toContain('--space @self')
})

function foreignTarget(kind: 'node' | 'space', id: string, collidingName = false) {
  const f = identityFixture()
  const target = { ...otherNode, id, name: 'Side', title: 'Side' }
  f.values['project.list'] = { projects: [project, otherProject] }
  f.io.fetch = vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    f.requests.push(request)
    let value = f.values[request.id]
    if (request.id === `${kind}.get`) {
      if (request.payload[`${kind}Id`] !== id) {
        return new Response(JSON.stringify({ ok: false, error: { code: `${kind}.not_found` } }))
      }
      value = { [kind]: target, projectId: otherProject.id }
    } else if (request.id === `${kind}.list`) {
      value = {
        projectId: request.payload.projectId,
        [kind === 'node' ? 'nodes' : 'spaces']:
          request.payload.projectId === otherProject.id
            ? [target]
            : collidingName
              ? [{ id: 'local-target', title: id, name: id, projectId: project.id }]
              : [],
      }
    }
    return new Response(JSON.stringify({ ok: true, value }))
  })
  return f
}

const foreignIds = ['00000000-0000-4000-8000-000000000000', 'brief-side']
const targetCommands = [
  { path: ['node', 'get'], kind: 'node' },
  { path: ['space', 'get'], kind: 'space' },
  { path: ['context'], kind: 'space' },
] as const

it.each(targetCommands)(
  'rejects foreign exact IDs for $path with an explicit project',
  async ({ path, kind }) => {
    await Promise.all(
      foreignIds.flatMap(id =>
        ['@self', project.id, project.name, project.id.slice(0, 9)].map(async selected => {
          const f = foreignTarget(kind, id, true)
          expect(await run([...path, `--${kind}`, id, '--project', selected], f.io)).toBe(1)
          expect(f.out()).toBe('')
          expect(f.error()).toMatchObject({
            code: `${kind}.not_found`,
            message: `${kind === 'node' ? 'Node' : 'Space'} "${id}" belongs to project "${otherProject.id}", not to the selected project "${project.id}"`,
            hint: expect.stringContaining('Drop --project'),
          })
          expect(f.error().hint).toContain('full ID across projects')
          expect(f.requests.filter(request => request.id === `${kind}.get`)).toHaveLength(1)
        }),
      ),
    )
  },
)

it.each(targetCommands)(
  'keeps foreign full IDs addressable for $path without explicit project scope',
  async ({ path, kind }) => {
    await Promise.all(
      foreignIds.map(async id => {
        const f = foreignTarget(kind, id, true)
        expect(await run([...path, `--${kind}`, id], f.io)).toBe(0)
        expect(JSON.parse(f.out())[kind].id).toBe(id)
        expect(f.requests.filter(request => request.id === `${kind}.get`)).toHaveLength(1)
      }),
    )
  },
)

it.each(targetCommands)(
  'accepts exact IDs for $path when the explicit project owns the target',
  async ({ path, kind }) => {
    await Promise.all(
      foreignIds.map(async id => {
        const f = foreignTarget(kind, id)
        expect(await run([...path, `--${kind}`, id, '--project', otherProject.id], f.io)).toBe(0)
        expect(JSON.parse(f.out())[kind].id).toBe(id)
        expect(f.requests.filter(request => request.id === `${kind}.get`)).toHaveLength(1)
      }),
    )
  },
)

it.each(['node list', 'context'])(
  'does not count the @self-defaulted project as explicit for %s',
  async name => {
    const id = foreignIds[0]
    const f = foreignTarget('space', id)
    const command = commands.find(candidate => candidate.path.join(' ') === name)!
    const argv = [...command.path, '--space', id]
    const parsed = await parseCommand(argv, command, f.io)
    expect(parsed.options.project).toBe('@self')
    expect(parsed.explicitOptions.has('project')).toBe(false)
    expect(await run(argv, f.io)).toBe(0)
    expect(f.requests.filter(request => request.id === 'space.get')).toHaveLength(1)
  },
)

it.each(['node', 'space'] as const)(
  'enforces explicit project scope for %s @self too',
  async kind => {
    const f = identityFixture()
    f.values['project.list'] = { projects: [project, otherProject] }
    expect(await run([kind, 'get', `--${kind}`, '@self', '--project', otherProject.id], f.io)).toBe(
      1,
    )
    expect(f.error().code).toBe(`${kind}.not_found`)
    expect(f.requests.filter(request => request.id === `${kind}.get`)).toHaveLength(1)
  },
)

it.each(['node', 'space'] as const)(
  'keeps exact names and prefixes inside the explicitly selected project for %s',
  async kind => {
    await Promise.all(
      ['Side', 'brief-'].flatMap(selector =>
        [project.id, otherProject.id].map(async selected => {
          const f = foreignTarget(kind, 'brief-side')
          expect(await run([kind, 'get', `--${kind}`, selector, '--project', selected], f.io)).toBe(
            selected === project.id ? 1 : 0,
          )
          expect(f.requests.find(request => request.id === `${kind}.list`)?.payload).toEqual({
            projectId: selected,
          })
        }),
      ),
    )
  },
)

it.each(['node', 'space', 'project'] as const)(
  'explains the minimum prefix length only for a matching short %s prefix',
  async kind => {
    const path = kind === 'project' ? ['mount', 'list'] : [kind, 'get']
    const f = identityFixture()
    expect(await run([...path, `--${kind}`, 'abcde'], f.io)).toBe(1)
    expect(f.error().hint).not.toContain('ID prefixes need at least 6 characters')
    const g = identityFixture()
    const id = { node: who.nodeId, space: who.spaceId, project: project.id }[kind]
    expect(await run([...path, `--${kind}`, id.slice(0, 5)], g.io)).toBe(1)
    expect(g.error()).toMatchObject({
      code: `${kind}.not_found`,
      hint: expect.stringContaining('ID prefixes need at least 6 characters'),
    })
  },
)
