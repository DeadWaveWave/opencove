import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'
import { commands } from '../../../src/app/cli/commands'
import type { CliIo } from '../../../src/app/cli/core/io'
// Keep full help text in compact goldens; escaped newlines preserve the exact output.
expect.addSnapshotSerializer({
  test: value => typeof value === 'string',
  serialize: value => JSON.stringify(value),
})
export function fixture() {
  let stdout = '',
    stderr = ''
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value: { result: 'value' } }),
      ),
  )
  const io: CliIo = {
    stdout: {
      write: s => {
        stdout += s
      },
    },
    stderr: {
      write: s => {
        stderr += s
      },
    },
    fetch,
    env: { OPENCOVE_CONTROL_URL: 'http://fixture:1', OPENCOVE_CONTROL_TOKEN: 'test' },
    now: Date.now,
    readTextFile: vi.fn(async () => '  中文🙂\n'),
    readStdinText: vi.fn(async () => '  中文🙂\n'),
  }
  return { io, fetch, out: () => stdout, err: () => stderr }
}
const cases: [string[], string, unknown][] = [
  [['endpoint', 'list'], 'endpoint.list', null],
  [
    [
      'endpoint',
      'register',
      '--hostname',
      'host',
      '--port',
      '123',
      '--remote-token',
      'secret',
      '--display-name',
      'Remote',
    ],
    'endpoint.register',
    { hostname: 'host', port: 123, token: 'secret', displayName: 'Remote' },
  ],
  [
    ['endpoint', 'ping', '--endpoint-id', 'e', '--ping-timeout', '500'],
    'endpoint.ping',
    { endpointId: 'e', timeoutMs: 500 },
  ],
  [['endpoint', 'remove', '--endpoint-id', 'e'], 'endpoint.remove', { endpointId: 'e' }],
  [['mount', 'list', '--project', 'p'], 'mount.list', { projectId: 'p' }],
  [
    [
      'mount',
      'create',
      '--project',
      'p',
      '--endpoint-id',
      'e',
      '--root-path',
      '/root',
      '--name',
      'Main',
    ],
    'mount.create',
    { projectId: 'p', endpointId: 'e', rootPath: '/root', name: 'Main' },
  ],
  [['mount', 'resolve', '--mount', 'm'], 'mountTarget.resolve', { mountId: 'm' }],
  [['mount', 'remove', '--mount', 'm'], 'mount.remove', { mountId: 'm' }],
  [['worktree', 'list'], 'worktree.list', null],
  [['worktree', 'list', '--project', 'p'], 'worktree.list', { projectId: 'p' }],
  [
    ['worktree', 'create', '--space', 's', '--name', 'branch'],
    'worktree.create',
    { spaceId: 's', name: 'branch' },
  ],
  [
    ['worktree', 'archive', '--space', 's', '--force', '--delete-branch'],
    'worktree.archive',
    { spaceId: 's', force: true, deleteBranch: true },
  ],
  [
    [
      'session',
      'run-agent',
      '--space',
      's',
      '--prompt-file',
      '-',
      '--provider',
      'codex',
      '--model',
      'model',
    ],
    'session.launchAgent',
    { spaceId: 's', prompt: '  中文🙂\n', provider: 'codex', model: 'model' },
  ],
  ...(['get', 'final', 'kill'] as const).map((name): [string[], string, unknown] => [
    ['session', name, '--session', 's'],
    { get: 'session.get', final: 'session.finalMessage', kill: 'session.kill' }[name],
    { sessionId: 's' },
  ]),
  [
    ['pty', 'spawn-in-mount', '--mount', 'm', '--cols', '80', '--rows', '24'],
    'pty.spawnInMount',
    { mountId: 'm', cols: 80, rows: 24 },
  ],
]
for (const [name, operation] of [
  ['read', 'readFileText'],
  ['write', 'writeFileText'],
  ['stat', 'stat'],
  ['ls', 'readDirectory'],
]) {
  for (const mount of [false, true]) {
    cases.push([
      [
        'fs',
        name,
        '--uri',
        'file:///a',
        ...(mount ? ['--mount', 'm'] : []),
        ...(name === 'write' ? ['--content-file', '-'] : []),
      ],
      `filesystem.${operation}${mount ? 'InMount' : ''}`,
      {
        uri: 'file:///a',
        ...(mount ? { mountId: 'm' } : {}),
        ...(name === 'write' ? { content: '  中文🙂\n' } : {}),
      },
    ])
  }
}
for (const [args, id, payload] of [
  [['list'], 'plugin.list', null],
  [['details', 'sample'], 'plugin.details', { pluginId: 'sample' }],
  [['install', './plugin'], 'plugin.install', { directory: resolve(process.cwd(), 'plugin') }],
  [['reload', 'sample'], 'plugin.reload', { pluginId: 'sample' }],
  [['uninstall', 'sample'], 'plugin.uninstall', { pluginId: 'sample' }],
  [['enable', 'sample'], 'plugin.setEnabled', { pluginId: 'sample', enabled: true }],
  [['disable', 'sample'], 'plugin.setEnabled', { pluginId: 'sample', enabled: false }],
  [['source', 'sample'], 'plugin.source', { pluginId: 'sample' }],
  [['check', 'sample'], 'plugin.git.check', { pluginId: 'sample' }],
  [['update', 'sample', '--ref', 'main'], 'plugin.git.update', { pluginId: 'sample', ref: 'main' }],
  [['apply', 'candidate'], 'plugin.git.apply', { candidateId: 'candidate' }],
  [
    ['rollback', 'sample', 'revision'],
    'plugin.rollback',
    { pluginId: 'sample', revision: 'revision' },
  ],
  [['discover', '--query', 'notes'], 'plugin.discover', { query: 'notes' }],
  [
    ['install-git', 'https://example.com/plugin.git', '--build', 'npm', '--build-output', 'dist'],
    'plugin.git.install',
    {
      repository: 'https://example.com/plugin.git',
      directory: '.',
      build: { kind: 'npm', script: 'build', outputDirectory: 'dist' },
    },
  ],
  [
    ['run', 'sample', 'status', '--params', '{}', '--node', 'n', '--view', 'v', '--project', 'p'],
    'plugin.command.run',
    {
      pluginId: 'sample',
      commandId: 'status',
      params: {},
      nodeId: 'n',
      viewId: 'v',
      projectId: 'p',
    },
  ],
  [['skill', 'sample', 'usage'], 'plugin.skill.get', { pluginId: 'sample', skillId: 'usage' }],
  [
    ['open', 'sample', '--project', 'p', '--space', 's'],
    'plugin.window.open',
    { pluginId: 'sample', projectId: 'p', spaceId: 's' },
  ],
  [['windows', 'sample'], 'plugin.window.list', { pluginId: 'sample' }],
] as [string[], string, unknown][]) {
  cases.push([['plugin', ...args], id, payload])
}
it.each(cases)('maps %j without leaking transport envelopes', async (args, id, payload) => {
  const f = fixture()
  expect(await run(args, f.io), f.err()).toBe(0)
  expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body))).toMatchObject({ id, payload })
  expect(f.out()).toBe('{"result":"value"}\n')
  expect(f.out()).not.toContain('__opencoveControlEnvelope')
})
it.each(
  commands.filter(c =>
    [
      'endpoint',
      'mount',
      'fs',
      'worktree',
      'session',
      'pty',
      'plugin',
      'worker',
      'runtime',
    ].includes(c.path[0]),
  ),
)('help for $path is offline', async command => {
  const f = fixture()
  expect(await run([...command.path, '--help'], f.io)).toBe(0)
  expect(f.out()).toMatchSnapshot()
  expect(f.fetch).not.toHaveBeenCalled()
})
it.each([
  ['mount', 'list', '--space', 's'],
  ['mount', 'list', '--project-id', 'p'],
  ['fs', 'write', '--uri', 'x'],
  ['fs', 'write', '--uri', 'x', '--content', 'x', '--content-file', '-'],
  ['session', 'run-agent', '--space', 's', '--prompt', 'x', '--prompt-file', '-'],
  ['plugin', 'run', 'sample', 'run', '--params', '{bad}'],
  ['plugin', 'run', 'sample', 'run', '--params', '{}', '--params-file', '-'],
  ['endpoint', 'register', '--hostname', 'host', '--port', '0', '--remote-token', 'x'],
])('rejects %j before transport', async (...args) => {
  const f = fixture()
  expect(await run(args, f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.out()).toBe('')
})
it('parses params-file JSON through the real core', async () => {
  const f = fixture()
  f.io.readTextFile = vi.fn(async () => '{"text":"中文🙂"}')
  expect(
    await run(['plugin', 'run', 'sample', 'status', '--params-file', 'params.json'], f.io),
  ).toBe(0)
  expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).payload.params).toEqual({
    text: '中文🙂',
  })
})

it.each(
  commands.filter(
    c =>
      ['endpoint', 'mount', 'fs', 'worktree', 'session', 'pty', 'plugin'].includes(c.path[0]) &&
      (Object.values(c.options ?? {}).some(o => o.required) ||
        c.positionals?.some(p => p.required)),
  ),
)('missing required input for $path never invokes', async command => {
  const f = fixture()
  expect(await run(command.path, f.io)).toBe(2)
  expect(f.out()).toBe('')
  expect(f.fetch).not.toHaveBeenCalled()
  expect(JSON.parse(f.err()).error.hint).toContain('--help')
})
