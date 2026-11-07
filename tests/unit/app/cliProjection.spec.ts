// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'
import type { CliIo } from '../../../src/app/cli/core/io'
function fixture(value: unknown = {}, error?: unknown) {
  let out = '',
    err = ''
  const fetch = vi.fn(
    async () => new Response(JSON.stringify(error ? { ok: false, error } : { ok: true, value })),
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
    readStdinText: vi.fn(),
    readTextFile: vi.fn(),
  }
  return { io, fetch, out: () => out, error: () => JSON.parse(err).error }
}
it.each([
  {
    args: ['node', 'list'],
    fields: 'id,data.status',
    value: {
      projectId: 'p',
      spaceId: 's',
      nodes: [{ id: 'n', title: 'Task', data: { status: 'doing', tags: [] } }],
    },
    expected: { projectId: 'p', spaceId: 's', nodes: [{ id: 'n', data: { status: 'doing' } }] },
  },
  {
    args: ['node', 'get', '--node', 'n'],
    fields: 'id',
    value: { node: { id: 'n', title: 'N' } },
    expected: { node: { id: 'n' } },
  },
  {
    args: ['node', 'create', 'note', '--space', 's'],
    fields: 'node.id',
    value: { revision: 4, node: { id: 'n', title: 'N' } },
    expected: { revision: 4, node: { id: 'n' } },
  },
  {
    args: ['node', 'update', 'note', '--node', 'n', '--text', 'hi'],
    fields: 'id',
    value: { revision: 5, node: { id: 'n', title: 'N' } },
    expected: { revision: 5, node: { id: 'n' } },
  },
  {
    args: ['space', 'get', '--space', 's'],
    fields: 'space.id',
    value: { projectId: 'p', space: { id: 's', name: 'Main' } },
    expected: { projectId: 'p', space: { id: 's' } },
  },
])('preserves envelopes %j', async ({ args, fields, value, expected }) => {
  const f = fixture(value)
  expect(await run([...args, '--fields', fields], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual(expected)
})
it.each([
  ['node', 'list'],
  ['node', 'get', '--node', 'n'],
  ['node', 'create', 'note', '--space', 's'],
  ['node', 'update', 'note', '--node', 'n'],
])('rejects unknown fields before requests %j', async (...args) => {
  const f = fixture()
  expect(await run([...args, '--fields', 'id,nope'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('validates raw API paths after reads, but never writes with projection', async () => {
  const f = fixture({ nested: { answer: 42 } })
  expect(await run(['api', 'call', 'system.homeDirectory', '--fields', 'nested.nope'], f.io)).toBe(
    2,
  )
  expect(f.fetch).toHaveBeenCalledTimes(1)
  const g = fixture()
  expect(
    await run(
      ['api', 'call', 'node.create', '--input', '{"kind":"note"}', '--fields', 'node.id'],
      g.io,
    ),
  ).toBe(2)
  expect(g.fetch).not.toHaveBeenCalled()
  expect(g.error().hint).toContain('before writing')
})
it('uses exit 2 for server input errors without issues', async () => {
  const f = fixture(null, { code: 'common.invalid_input', debugMessage: 'Requirement is required' })
  expect(await run(['api', 'call', 'node.create', '--input', '{"kind":"task"}'], f.io)).toBe(2)
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('renders not-found sentences while preserving recovery data', async () => {
  const f = fixture(null, { code: 'node.not_found' })
  expect(await run(['node', 'get', '--node', 'abc'], f.io)).toBe(1)
  expect(f.error()).toMatchObject({
    message: 'Node "abc" was not found',
    details: { nodeId: 'abc' },
  })
})
it('suggests a misspelled nested command', async () => {
  const f = fixture()
  expect(await run(['node', 'creat'], f.io)).toBe(2)
  expect(f.error().hint).toContain('Did you mean node create?')
})
it('reports JSON line, column and parser reason', async () => {
  const f = fixture()
  expect(await run(['api', 'call', 'node.get', '--input', '{\n"nodeId": }'], f.io)).toBe(2)
  expect(f.error().message).toMatch(/line 2, column \d+:/)
  expect(f.error().message).toMatch(/Unexpected|Expected/)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('explains approved roots and conflicting locator flags', async () => {
  const f = fixture(null, { code: 'common.approved_path_required' })
  expect(await run(['fs', 'read', '--uri', 'file:///outside'], f.io)).toBe(1)
  expect(f.error().hint).toContain('opencove mount list --project <id>')
  const g = fixture()
  expect(await run(['node', 'list', '--space', 's', '--space-name', 'Main'], g.io)).toBe(2)
  expect(g.error().message).toContain('--space, --space-name')
})
it('includes dedicated commands by default and summarizes operation domains', async () => {
  const f = fixture()
  expect(await run(['api', 'ops', '--prefix', 'node'], f.io)).toBe(0)
  const rows = JSON.parse(f.out())
  expect(rows.find((row: { id: string }) => row.id === 'node.create').command).toBe(
    'opencove node create',
  )
  const raw = fixture()
  expect(await run(['api', 'ops', '--prefix', 'system'], raw.io)).toBe(0)
  expect(
    JSON.parse(raw.out()).find((row: { id: string }) => row.id === 'system.homeDirectory'),
  ).not.toHaveProperty('command')
  const g = fixture()
  expect(await run(['api', 'ops', '--domains', '--prefix', 'node'], g.io)).toBe(0)
  expect(JSON.parse(g.out())).toEqual([{ domain: 'node', operations: 5, schema: 5, commands: 3 }])
})
it('shows task state in node tables without changing runtime status', async () => {
  const f = fixture({
    nodes: [
      { id: 'task', kind: 'task', title: 'T', data: { status: 'doing' } },
      { id: 'agent', kind: 'agent', title: 'A', status: 'running', data: { kind: 'agent' } },
    ],
  })
  expect(await run(['node', 'list', '-o', 'table'], f.io)).toBe(0)
  expect(f.out()).toContain('STATE')
  expect(f.out()).toContain('doing')
  expect(f.out()).toContain('running')
})

it.each([
  ['{\n"nodeId": }', 2, 11],
  ['{\n  "nodeId": true,\n}', 3, 1],
  ['[1,]', 1, 4],
  ['truX', 1, 4],
  ['{"nodeId":1} trailing', 1, 14],
])('locates malformed JSON precisely %s', async (input, line, column) => {
  const f = fixture()
  expect(await run(['api', 'call', 'node.get', '--input', String(input)], f.io)).toBe(2)
  expect(f.error().message).toContain(`line ${line}, column ${column}:`)
  expect(f.fetch).not.toHaveBeenCalled()
})
