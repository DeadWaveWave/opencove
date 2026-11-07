// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  getWorkerLifecycleStatus,
  stopWorkerLifecycle,
} from '../../../src/app/cli/workerLifecycle.mjs'
import { commands } from '../../../src/app/cli/commands'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'
import type { CliIo } from '../../../src/app/cli/core/io'

vi.mock('../../../src/app/cli/workerLifecycle.mjs', () => ({
  getWorkerLifecycleStatus: vi.fn(async () => ({
    status: 'running',
    workers: [{ pid: 42, port: 4312 }],
  })),
  stopWorkerLifecycle: vi.fn(async () => ({ status: 'stopped', stopped: true, pid: 42 })),
  WorkerLifecycleError: class extends Error {},
}))

function fixture(value: unknown) {
  let out = '',
    err = ''
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(JSON.stringify({ ok: true, value })),
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
  return {
    io,
    fetch,
    text: () => out,
    out: () => JSON.parse(out),
    err: () => JSON.parse(err).error,
  }
}
const mount = [
  'mount',
  'create',
  '--project',
  'p',
  '--endpoint-id',
  'local',
  '--root-path',
  '/repo',
]
it.each(['id', 'plugins.id'])(
  'projects plugin list item fields %s and keeps its envelope',
  async fields => {
    const f = fixture({ plugins: [{ id: 'sample', displayName: 'Sample' }], revision: 7 })
    expect(await run(['plugin', 'list', '--fields', fields], f.io)).toBe(0)
    expect(f.out()).toEqual({ plugins: [{ id: 'sample' }], revision: 7 })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  },
)
it.each(['mountId', 'mount.mountId'])('projects a non-node mutation %s', async fields => {
  const f = fixture({ mount: { mountId: 'm', name: 'Main' }, revision: 8, projectId: 'p' })
  expect(await run([...mount, '--fields', fields], f.io)).toBe(0)
  expect(f.out()).toEqual({ mount: { mountId: 'm' }, revision: 8, projectId: 'p' })
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it.each([
  { args: ['plugin', 'list'], fields: 'id,nope', value: { plugins: [] } },
  { args: mount, fields: 'mountId,nope', value: {} },
  { args: ['plugin', 'install', './sample'], fields: 'id,nope', value: {} },
  {
    args: ['worker', 'stop', '--user-data', '/fixture/worker-profile'],
    fields: 'status,nope',
    value: {},
  },
])('rejects unknown fields before any IO: $args', async ({ args, fields, value }) => {
  vi.mocked(stopWorkerLifecycle).mockClear()
  const f = fixture(value)
  expect(await run([...args, '--fields', fields], f.io)).toBe(2)
  expect(f.err().message).toContain('Unknown fields: nope')
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.io.readTextFile).not.toHaveBeenCalled()
  expect(stopWorkerLifecycle).not.toHaveBeenCalled()
})
it('keeps an empty plugin list in its envelope', async () => {
  const f = fixture({ plugins: [] })
  expect(await run(['plugin', 'list', '--fields', 'id'], f.io)).toBe(0)
  expect(f.out()).toEqual({ plugins: [] })
})
it.each([
  {
    args: ['plugin', 'details', 'sample'],
    fields: 'plugin.id',
    value: { plugin: { id: 'sample', version: '1' }, readme: 'Doc' },
    expected: { plugin: { id: 'sample' }, readme: 'Doc' },
  },
  {
    args: ['plugin', 'install', './sample'],
    fields: 'id',
    value: { id: 'sample', version: '1' },
    expected: { id: 'sample' },
  },
  {
    args: ['plugin', 'reload', 'sample'],
    fields: 'plugin.id',
    value: { id: 'sample', version: '1' },
    expected: { id: 'sample' },
  },
  {
    args: ['plugin', 'reload', 'sample'],
    fields: 'id',
    value: { status: 'updated', candidateId: 'c', plugin: { id: 'sample', version: '1' } },
    expected: { status: 'updated', candidateId: 'c', plugin: { id: 'sample' } },
  },
  {
    args: ['plugin', 'discover'],
    fields: 'repositories.name',
    value: {
      source: 'github',
      installAutomatically: false,
      repositories: [{ name: 'sample', stars: 2 }],
    },
    expected: { source: 'github', installAutomatically: false, repositories: [{ name: 'sample' }] },
  },
  {
    args: ['worktree', 'create', '--space', 's'],
    fields: 'worktree.path',
    value: { projectId: 'p', spaceId: 's', worktree: { path: '/repo', branch: 'main' } },
    expected: { projectId: 'p', spaceId: 's', worktree: { path: '/repo' } },
  },
  {
    args: ['worktree', 'archive', '--space', 's'],
    fields: 'deletedBranchName',
    value: { projectId: 'p', removed: null },
    expected: { projectId: 'p', removed: null },
  },
  { args: ['mount', 'resolve', '--mount', 'm'], fields: 'mountId', value: null, expected: null },
  {
    args: ['session', 'run-agent', '--space', 's', '--prompt', 'hi'],
    fields: 'sessionId',
    value: { sessionId: 'session', provider: 'codex' },
    expected: { sessionId: 'session' },
  },
])('projects declared result shapes: $args', async ({ args, fields, value, expected }) => {
  const f = fixture(value)
  expect(await run([...args, '--fields', fields], f.io)).toBe(0)
  expect(f.out()).toEqual(expected)
})
it.each([
  ['plugin', 'run', 'sample', 'status'],
  ['fs', 'write', '--uri', 'file:///repo/note', '--content', 'hi'],
  ['mount', 'remove', '--mount', 'm'],
  ['session', 'kill', '--session', 's'],
])('rejects opaque or void results before execution: %j', async (...args) => {
  const f = fixture(null)
  expect(await run([...args, '--fields', 'id'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('audits projection support for every command, with only explicit non-item exceptions', () => {
  const exceptions = [
    'api call',
    'pty attach',
    'plugin run',
    'fs write',
    'mount remove',
    'session kill',
  ]
  expect(
    commands
      .filter(c => !c.render?.fields)
      .map(c => c.path.join(' '))
      .sort(),
  ).toEqual(exceptions.sort())
})
it.each([
  'plugin list',
  'plugin details',
  'plugin reload',
  'plugin run',
  'mount create',
  'worktree create',
  'worker status',
])('projection help golden %s', async path => {
  const f = fixture(null)
  expect(await run([...path.split(' '), '--help'], f.io)).toBe(0)
  expect(f.text()).toMatchSnapshot()
  expect(f.fetch).not.toHaveBeenCalled()
})

it('projects local worker status and stop receipts without accessing a real profile', async () => {
  const read = fixture(null)
  expect(await run(['worker', 'status', '--fields', 'workers.pid'], read.io)).toBe(0)
  expect(read.out()).toEqual({ status: 'running', workers: [{ pid: 42 }] })
  expect(getWorkerLifecycleStatus).toHaveBeenCalled()
  const stop = fixture(null)
  expect(await run(['worker', 'stop', '--fields', 'status'], stop.io)).toBe(0)
  expect(stop.out()).toEqual({ status: 'stopped' })
  expect(stopWorkerLifecycle).toHaveBeenCalled()
})

it.each(
  ['reload', 'update'].flatMap(command =>
    [
      { status: 'failed', error: 'Build exited with code 1' },
      { status: 'failed', error: 'Publication rejected a stale candidate' },
      { status: 'conflict', error: 'Merge conflict in plugin source' },
    ].flatMap(failure =>
      [undefined, 'id', 'plugin.id'].map(fields => ({ command, fields, ...failure })),
    ),
  ),
)(
  'preserves $command failure details before projection ($fields): $error',
  async ({ command, fields, status, error }) => {
    // Distribution failures are successful transport responses without a plugin item.
    const receipt = { status, candidateId: 'candidate-1', candidateDirectory: '/plugins/c1', error }
    const f = fixture(receipt)
    const args = ['plugin', command, 'sample', '-o', 'json']
    if (fields !== undefined) {
      args.push('--fields', fields)
    }
    expect(await run(args, f.io)).toBe(1)
    expect(f.text()).toBe('')
    expect(f.err()).toEqual({
      code: 'plugin.failed',
      message: 'Plugin operation needs attention',
      hint: 'Inspect the candidate details before retrying.',
      details: receipt,
    })
    expect(f.fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      id: command === 'reload' ? 'plugin.reload' : 'plugin.git.update',
      payload: { pluginId: 'sample' },
    })
  },
)
