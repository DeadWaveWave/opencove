// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, project, space, node, who } from './cliIdentity.helpers'

const beta = { id: 'project-beta', name: 'Beta', path: '/beta', activeSpaceId: 'space-beta' }
const betaSpace = { id: beta.activeSpaceId, name: 'Beta space', directoryPath: '/beta', nodes: [] }
const betaNode = {
  ...node,
  id: 'node-beta',
  projectId: beta.id,
  spaceId: betaSpace.id,
  title: 'Beta shell',
}

function twoProjects() {
  const f = identityFixture()
  const alpha = { ...project, name: 'Alpha' }
  f.values['project.list'] = { projects: [alpha, beta] }
  f.io.fetch = vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    f.requests.push(request)
    const { id, payload } = request
    let value = f.values[id]
    if (id === 'space.get') {
      value =
        payload.spaceId === betaSpace.id
          ? { projectId: beta.id, space: betaSpace }
          : { projectId: alpha.id, space }
    } else if (id === 'space.list') {
      value = { spaces: payload.projectId === beta.id ? [betaSpace] : [space] }
    } else if (id === 'node.list') {
      // Mirror the server's locator precedence: space wins over project.
      value = {
        nodes: payload.space
          ? payload.space.spaceId === betaSpace.id
            ? [betaNode]
            : [node]
          : payload.projectId === beta.id
            ? [betaNode]
            : [node],
      }
    }
    return new Response(JSON.stringify({ ok: true, value }))
  })
  return f
}

it.each(['Beta', '@self'])('respects an explicit project for context: %s', async selector => {
  const f = twoProjects()
  const target = selector === '@self' ? project : beta
  const targetSpace = selector === '@self' ? space : betaSpace
  expect(await run(['context', '--project', selector], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({
    project: { id: target.id },
    space: { id: targetSpace.id },
  })
  expect(f.requests.find(request => request.id === 'space.get')?.payload).toEqual({
    spaceId: targetSpace.id,
  })
})

it.each(['Beta', '@self'])(
  'leaves space unset for explicit project-wide node list: %s',
  async selector => {
    const f = twoProjects()
    const target = selector === '@self' ? project : beta
    expect(await run(['node', 'list', '--project', selector], f.io)).toBe(0)
    expect(f.requests.find(r => r.id === 'node.list')).toMatchObject({
      id: 'node.list',
      payload: { projectId: target.id },
    })
    expect(f.requests.find(r => r.id === 'node.list')?.payload).not.toHaveProperty('space')
    expect(JSON.parse(f.out()).nodes[0].projectId).toBe(target.id)
  },
)

it('uses the explicitly selected project active space rather than the caller space in that project', async () => {
  const f = twoProjects()
  const activeSpace = { ...space, id: 'space-alpha-active', name: 'Alpha active' }
  f.values['project.list'] = { projects: [{ ...project, activeSpaceId: activeSpace.id }] }
  const transport = f.io.fetch
  f.io.fetch = vi.fn(async (url, init) => {
    const request = JSON.parse(String(init?.body))
    if (request.id === 'space.get' && request.payload.spaceId === activeSpace.id) {
      f.requests.push(request)
      return new Response(
        JSON.stringify({ ok: true, value: { projectId: project.id, space: activeSpace } }),
      )
    }
    return transport(url, init)
  })
  expect(await run(['context', '--project', '@self'], f.io)).toBe(0)
  expect(f.requests.find(request => request.id === 'space.get')?.payload).toEqual({
    spaceId: activeSpace.id,
  })
  expect(JSON.parse(f.out())).toMatchObject({
    project: { id: project.id },
    space: { id: activeSpace.id },
  })
})

it.each(['', undefined])('orients an ungrouped terminal with space env=%s', async spaceEnv => {
  const f = twoProjects()
  f.io.env.OPENCOVE_SPACE_ID = spaceEnv
  f.values['system.whoami'] = { ...who, spaceId: '' }
  expect(await run(['context'], f.io)).toBe(0)
  const result = JSON.parse(f.out())
  expect(result).toMatchObject({
    self: { caller: 'session-grant', scope: 'interact', spaceId: null, nodeId: node.id },
    project: { id: project.id },
    space: null,
    nodes: [],
  })
  expect(result.next).toHaveLength(4)
  expect(result.next.join(' ')).toContain('--project "@self"')
  expect(result.next.join(' ')).not.toContain('--space')
  expect(result.self.node).toMatchObject({
    id: node.id,
    kind: 'terminal',
    title: 'Shell',
    state: 'running',
  })
  expect(f.requests.some(request => request.id === 'space.get')).toBe(false)
  expect(f.requests.filter(request => request.id === 'node.list')).toEqual([
    { id: 'node.list', kind: 'query', payload: { projectId: project.id, kind: 'task' } },
  ])
})

it('reports absent space membership rather than absent session identity for explicit @self', async () => {
  const f = identityFixture()
  f.io.env.OPENCOVE_SPACE_ID = ''
  f.values['system.whoami'] = { ...who, spaceId: '' }
  expect(await run(['space', 'get', '--space', '@self'], f.io)).toBe(2)
  expect(f.error().message).toContain('does not belong to a space')
  expect(f.error().message).not.toContain('only works inside')
  expect(f.requests.some(request => request.id === 'space.get')).toBe(false)
})

it('requires an explicit space when creating in an explicitly selected project', async () => {
  const f = twoProjects()
  expect(await run(['node', 'create', 'note', '--project', 'Beta'], f.io)).toBe(2)
  expect(f.io.fetch).not.toHaveBeenCalled()
})

it('lets an ungrouped terminal explicitly orient in a selected space', async () => {
  const f = twoProjects()
  f.io.env.OPENCOVE_SPACE_ID = ''
  f.values['system.whoami'] = { ...who, spaceId: '' }
  expect(await run(['context', '--project', 'Beta', '--space', 'Beta space'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({
    self: { spaceId: null },
    project: { id: beta.id },
    space: { id: betaSpace.id },
  })
})
