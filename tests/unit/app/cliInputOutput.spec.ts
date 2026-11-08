// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'
import { commands } from '../../../src/app/cli/commands'
import { globals } from '../../../src/app/cli/core/args'
import type { CliIo } from '../../../src/app/cli/core/io'
import { AGENT_PROVIDER_IDS } from '../../../src/shared/contracts/dto'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

function fixture(value: unknown = {}, error?: unknown) {
  let out = '',
    err = ''
  const fetch = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify(error ? { ok: false, error } : { ok: true, value })),
  )
  const io: CliIo = {
    stdout: {
      write: s => {
        out += s
      },
    },
    stderr: {
      write: s => {
        err += s
      },
    },
    env: { OPENCOVE_CONTROL_URL: 'http://fake', OPENCOVE_CONTROL_TOKEN: 'fake' },
    fetch,
    now: Date.now,
    readTextFile: vi.fn(),
    readStdinText: vi.fn(),
  }
  return { io, fetch, out: () => out, err: () => err, error: () => JSON.parse(err).error }
}

it.each([
  [['node', 'list', '--kind', 'notes'], '--kind', 'notes', 'note, task, website, agent, terminal'],
  [['api', 'ops', '--kind', 'banana'], '--kind', 'banana', 'query, command'],
  [['api', 'ops', '--contract', 'banana'], '--contract', 'banana', 'schema, legacy'],
  [
    ['node', 'update', 'task', '--node', 'n', '--priority', 'critical'],
    '--priority',
    'critical',
    'low, medium, high, urgent',
  ],
  [
    ['node', 'update', 'task', '--node', 'n', '--status', 'ready'],
    '--status',
    'ready',
    'todo, doing, ai_done, done',
  ],
  [
    ['node', 'update', 'website', '--node', 'n', '--session-mode', 'private'],
    '--session-mode',
    'private',
    'shared, incognito, profile',
  ],
  [
    ['node', 'update', 'website', '--node', 'n', '--pinned', 'yes'],
    '--pinned',
    'yes',
    'true, false',
  ],
  [['plugin', 'install-git', 'repo', '--build', 'yarn'], '--build', 'yarn', 'none, npm, pnpm'],
  [['node', 'list', '-o', 'csv'], '--output', 'csv', 'json, table'],
  [
    ['api', 'schema', 'node.create', '--variant', 'notes'],
    '--variant',
    'notes',
    'note, task, website, agent, terminal',
  ],
])('diagnoses choice errors before IO: %j', async (args, field, value, choices) => {
  const f = fixture()
  expect(await run(args as string[], f.io)).toBe(2)
  expect(f.out()).toBe('')
  expect(f.error().message).toContain(
    `Invalid ${field} ${JSON.stringify(value)}: expected one of ${choices}`,
  )
  expect(f.err()).not.toContain('The request was invalid.')
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each([
  { code: 'invalid_value', values: ['low', 'medium', 'high', 'urgent'] },
  {
    code: 'invalid_enum_value',
    options: ['low', 'medium', 'high', 'urgent'],
    received: 'critical',
  },
])('formats server enum issues: $code', async issue => {
  const issues = [{ ...issue, path: ['data', 'priority'], message: 'The request was invalid.' }]
  const f = fixture(null, { code: 'common.invalid_input', details: { issues } })
  expect(
    await run(['api', 'call', 'node.update', '--input', '{"data":{"priority":"critical"}}'], f.io),
  ).toBe(2)
  expect(f.error().message).toBe(
    'Invalid data.priority "critical": expected one of low, medium, high, urgent',
  )
  expect(f.error().details.issues).toEqual(issues)
  expect(f.out()).toBe('')
})

it.each([
  { code: 'common.invalid_input' },
  { code: 'common.invalid_input', debugMessage: 'The request was invalid.' },
  { code: 'common.invalid_input', details: { issues: [] } },
  {
    code: 'common.invalid_input',
    details: { issues: [{ path: ['nodeId'], message: 'The request was invalid.' }] },
  },
])('never prints the generic input message: %j', async error => {
  const f = fixture(null, error)
  expect(await run(['api', 'call', 'node.get'], f.io)).toBe(2)
  expect(f.error().message).toContain('Invalid input for node.get')
  expect(f.error().message).not.toContain('The request was invalid.')
  expect(f.out()).toBe('')
})

it('keeps local semantic errors specific', async () => {
  const f = fixture()
  expect(await run(['node', 'get', '--node', ''], f.io)).toBe(2)
  expect(f.error().message).toBe('Invalid input for node.get: Missing nodeId.')
  expect(f.fetch).not.toHaveBeenCalled()
})

it('declares fixed choices instead of checking help labels at runtime', () => {
  for (const command of commands) {
    for (const [name, spec] of Object.entries({ ...globals, ...command.options })) {
      if (spec.type === 'string' && spec.valueName?.includes('|')) {
        expect(spec, `${command.path.join(' ')} --${name}`).toHaveProperty('choices')
      }
    }
  }
})

it.each([
  ['node', 'create', 'agent', '--space', 's'],
  ['session', 'run-agent', '--space', 's', '--prompt', 'Review'],
])('declares provider choices for %j', async (...args) => {
  const f = fixture()
  expect(await run([...args, '--provider', 'unknown'], f.io)).toBe(2)
  expect(f.error().message).toBe(
    `Invalid --provider "unknown": expected one of ${AGENT_PROVIDER_IDS.join(', ')}, ""`,
  )
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each([' codex ', ''])('preserves session provider normalization: %j', async provider => {
  const f = fixture()
  expect(
    await run(
      ['session', 'run-agent', '--space', 's', '--prompt', 'Review', '--provider', provider],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).payload.provider).toBe(provider.trim())
})

it('keeps the received value in normalized choice errors', async () => {
  const f = fixture()
  expect(
    await run(
      ['session', 'run-agent', '--space', 's', '--prompt', 'Review', '--provider', ' invalid '],
      f.io,
    ),
  ).toBe(2)
  expect(f.error().message).toContain('Invalid --provider " invalid ": expected one of')
})

it.each([
  { path: ['items', 0, 'kind'], values: ['note', 'task'], input: 'notes' },
  { path: ['items', 0, 'kind'], values: ['note', 'task'] },
])('recovers nested enum input from issues or the request: %j', async issue => {
  const f = fixture(null, { code: 'common.invalid_input', details: { issues: [issue] } })
  expect(
    await run(['api', 'call', 'node.get', '--input', '{"items":[{"kind":"notes"}]}'], f.io),
  ).toBe(2)
  expect(f.error().message).toBe('Invalid items.0.kind "notes": expected one of note, task')
  expect(f.out()).toBe('')
})

it('projects domain summaries and lists their fields on errors', async () => {
  const f = fixture()
  expect(
    await run(
      ['api', 'ops', '--domains', '--fields', 'domain,operations,schema,commandOperations'],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out())).toContainEqual({
    domain: 'node',
    operations: 5,
    schema: 5,
    commandOperations: 3,
  })
  const g = fixture()
  expect(await run(['api', 'ops', '--domains', '--fields', 'id'], g.io)).toBe(2)
  expect(g.error().message).toBe(
    'Unknown fields: id. Available fields: domain, operations, schema, commandOperations',
  )
  expect(g.out()).toBe('')
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each(['id,title', 'node.id,node.title', 'id,node.title'])(
  'accepts aliases and raw paths: %s',
  async fields => {
    const f = fixture({ revision: 2, node: { id: 'n', title: 'Note', data: { text: 'Text' } } })
    expect(await run(['api', 'call', 'node.get', '--fields', fields], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual({ node: { id: 'n', title: 'Note' } })
  },
)

it.each([{ nodes: [] }, { nodes: [{ id: 'n', data: { kind: 'note' } }] }])(
  'maps list aliases with optional fields: %j',
  async ({ nodes }) => {
    const f = fixture({ projectId: 'p', nodes })
    expect(await run(['api', 'call', 'node.list', '--fields', 'id,data.status'], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual({ nodes: nodes.map(({ id }) => ({ id })) })
  },
)

it('reuses alternate operation declarations', async () => {
  const f = fixture({ entries: [{ name: 'README.md', uri: 'file:///repo/README.md' }] })
  expect(
    await run(['api', 'call', 'filesystem.readDirectoryInMount', '--fields', 'name'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ entries: [{ name: 'README.md' }] })
})

it.each(['titel', 'node.titel'])('lists valid raw paths for %s', async fields => {
  const f = fixture({ projectId: 'p', node: { id: 'n', title: 'Note' } })
  expect(await run(['api', 'call', 'node.get', '--fields', fields], f.io)).toBe(2)
  expect(f.error().message).toContain(`Unknown output paths: ${fields}. Available raw paths:`)
  expect(f.error().message).toContain('node.id')
  if (fields === 'titel') {
    expect(f.error().hint).toContain('node.titel')
    expect(f.error().hint).toContain('node.id')
  }
  expect(f.out()).toBe('')
})

it('lists actual raw paths for operations without dedicated contracts', async () => {
  const f = fixture({ homeDirectory: '/home', platform: 'linux' })
  expect(await run(['api', 'call', 'system.homeDirectory', '--fields', 'home'], f.io)).toBe(2)
  expect(f.error().message).toContain('Available raw paths: homeDirectory, platform')
})

it('keeps raw envelope paths and rejects unknown paths on populated lists', async () => {
  const f = fixture({ projectId: 'p', nodes: [] })
  expect(await run(['api', 'call', 'node.list', '--fields', 'projectId,nodes.id'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ projectId: 'p', nodes: [] })
  const g = fixture({ nodes: [{ id: 'n' }] })
  expect(await run(['api', 'call', 'node.list', '--fields', 'nodes.invented'], g.io)).toBe(2)
})

it.each([{ sessions: [] }, { sessions: [{ sessionId: 's', provider: 'codex' }] }])(
  'preserves undeclared raw collection paths: %j',
  async value => {
    expect(commands.some(command => command.operation === 'session.list')).toBe(false)
    const f = fixture(value)
    expect(await run(['api', 'call', 'session.list', '--fields', 'sessions.sessionId'], f.io)).toBe(
      0,
    )
    expect(JSON.parse(f.out())).toEqual({
      sessions: value.sessions.map(({ sessionId }) => ({ sessionId })),
    })
    expect(f.err()).toBe('')
  },
)

it.each([
  { sessions: [] },
  { sessions: [{ children: [] }] },
  { sessions: [{ children: [{ sessionId: 's', extra: true }] }] },
])('preserves traversal through nested empty arrays: %j', async value => {
  const f = fixture(value)
  expect(
    await run(['api', 'call', 'session.list', '--fields', 'sessions.children.sessionId'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    sessions: value.sessions.map(({ children }) => ({
      children: children?.map(({ sessionId }) => ({ sessionId })),
    })),
  })
})

it('still rejects absent raw paths in populated undeclared collections', async () => {
  const f = fixture({ sessions: [{ sessionId: 's' }] })
  expect(await run(['api', 'call', 'session.list', '--fields', 'sessions.missing'], f.io)).toBe(2)
  expect(f.error().message).toContain('Available raw paths: sessions, sessions.sessionId')
  expect(f.out()).toBe('')
})

it.each([
  [{ 'api.key': 'configured' }, 'api.key', 'none'],
  [
    { preferences: { 'api.key': 'configured', theme: 'dark' } },
    'preferences.api.key',
    'preferences, preferences.theme',
  ],
])('rejects unaddressable literal keys: %j', async (value, fields, available) => {
  const f = fixture(value)
  expect(
    await run(
      [
        'api',
        'call',
        'plugin.preferences.get',
        '--input',
        '{"pluginId":"sample"}',
        '--fields',
        fields as string,
      ],
      f.io,
    ),
  ).toBe(2)
  expect(f.error().message).toBe(
    `Unknown output paths: ${fields}. Available raw paths: ${available}`,
  )
  expect(f.out()).toBe('')
})

it('uses nested semantics when literal dotted and nested keys coexist', async () => {
  const f = fixture({ 'api.key': 'literal', api: { key: 'nested', extra: true } })
  expect(await run(['api', 'call', 'plugin.preferences.get', '--fields', 'api.key'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ api: { key: 'nested' } })
})

async function registeredError(id: string, payload: unknown) {
  const operation = getControlSurfaceOperation(id)!
  if (operation.contract !== 'schema') {
    throw Error('Expected a schema operation')
  }
  const surface = createControlSurface()
  const handle = vi.fn()
  registerOperation(surface, operation as Parameters<typeof registerOperation>[1], {
    handle,
    defaultErrorCode: 'common.unexpected',
  })
  const response = await surface.invoke({ now: () => new Date() } as ControlSurfaceContext, {
    id: operation.id,
    kind: operation.kind,
    payload,
  })
  expect(handle).not.toHaveBeenCalled()
  if (response.ok) {
    throw Error('Expected a real validator error')
  }
  return response.error
}

it.each([
  [
    'node.list',
    { kind: 'banana' },
    'kind',
    'banana',
    'note, task, website, agent, terminal, plugin, document, folder, image, role',
  ],
  [
    'session.launchAgent',
    { spaceId: 's', prompt: 'Review', provider: 'unknown' },
    'provider',
    'unknown',
    `${AGENT_PROVIDER_IDS.join(', ')}, ""`,
  ],
  [
    'session.launchAgent',
    { spaceId: 's', prompt: 'Review', provider: ' unknown ' },
    'provider',
    ' unknown ',
    `${AGENT_PROVIDER_IDS.join(', ')}, ""`,
  ],
])('formats real registered enum failures for %s', async (id, payload, field, value, allowed) => {
  const descriptor = await registeredError(id as string, payload)
  expect(descriptor.code).toBe('common.invalid_input')
  expect(descriptor.details).toBeUndefined()
  const f = fixture(null, descriptor)
  expect(await run(['api', 'call', id as string, '--input', JSON.stringify(payload)], f.io)).toBe(2)
  expect(f.error().message).toBe(
    `Invalid ${field} ${JSON.stringify(value)}: expected one of ${allowed}`,
  )
  expect(f.fetch).toHaveBeenCalledOnce()
  expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).payload).toEqual(payload)
  expect(f.out()).toBe('')
})

it.each([
  [{ provider: 'unknown', spaceId: 's' }, 'prompt: Invalid input: expected string'],
  [{ provider: ' codex ', prompt: 'Review' }, 'requires either spaceId or cwd'],
])('preserves unrelated real validation errors: %j', async (payload, message) => {
  const descriptor = await registeredError('session.launchAgent', payload)
  const f = fixture(null, descriptor)
  expect(
    await run(['api', 'call', 'session.launchAgent', '--input', JSON.stringify(payload)], f.io),
  ).toBe(2)
  expect(f.error().message).toContain(message)
  expect(f.out()).toBe('')
})

it('prefers raw paths when an envelope field collides with an item alias', async () => {
  const f = fixture({ projectId: 'envelope', nodes: [{ projectId: 'item' }] })
  expect(
    await run(['api', 'call', 'node.list', '--fields', 'projectId,nodes.projectId'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ projectId: 'envelope', nodes: [{ projectId: 'item' }] })
})

it('keeps generic mutation projection unavailable before IO', async () => {
  const f = fixture()
  expect(await run(['api', 'call', 'node.update', '--fields', 'id'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each(['data.text', 'nodes.data.text', 'data.prompt'])(
  'directs omitted content to node get: %s',
  async field => {
    const f = fixture()
    expect(await run(['node', 'list', '--fields', field], f.io)).toBe(2)
    expect(f.error().hint).toContain(
      `opencove node get --node <id> --fields ${field.replace(/^nodes\./, '')}`,
    )
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.out()).toBe('')
  },
)

it.each(['', 'api', 'api ops', 'api ops --domains', 'api call', 'node list'])(
  'command help snapshots: %s',
  async path => {
    const f = fixture()
    expect(await run([...path.split(' ').filter(Boolean), '--help'], f.io)).toBe(0)
    expect(f.out()).toMatchSnapshot()
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.io.readTextFile).not.toHaveBeenCalled()
  },
)

it.each([[], ['api']])('leads with filtered discovery: %j', async (...path) => {
  const f = fixture()
  expect(await run([...path, '--help'], f.io)).toBe(0)
  expect(f.out()).toContain('opencove api ops --domains')
  expect(f.out()).toContain('opencove api ops --prefix node --fields id,cliCommand')
})

it('reports the approximate full JSON catalog size without changing its output', async () => {
  const f = fixture(),
    g = fixture()
  expect(await run(['api', 'ops'], f.io)).toBe(0)
  expect(await run(['api', 'ops', '--help'], g.io)).toBe(0)
  // Rounded so adding an operation does not change the help text.
  expect(g.out()).toContain(`about ${Math.round(Buffer.byteLength(f.out().trimEnd()) / 1024)} KB`)
  expect(g.out()).toContain('large')
  expect(g.out()).toContain('--domains')
  expect(f.err()).toBe('')
})
