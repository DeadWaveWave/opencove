import { describe, expect, it } from 'vitest'
import {
  parsePluginCommand,
  resolvePluginCommandTimeout,
} from '../../../src/app/cli/commands/plugins.mjs'
import {
  gitInstallInput,
  pluginGitRef,
} from '../../../src/contexts/plugins/domain/pluginDistributionValidation'
import { resolvePluginBuildInvocation } from '../../../src/contexts/plugins/infrastructure/pluginBuildInvocation'

describe('explicit plugin distribution CLI contract', () => {
  it('parses pinned sources and explicit frozen build strategy without shell expansion', () => {
    const request = parsePluginCommand([
      'plugin',
      'install-git',
      'https://github.com/example/plugin.git',
      '--ref',
      'v1.0',
      '--directory',
      'packages/plugin',
      '--build',
      'npm',
      '--script',
      'build',
      '--output',
      'dist',
    ])
    expect(request).toEqual({
      kind: 'command',
      id: 'plugin.git.install',
      payload: {
        repository: 'https://github.com/example/plugin.git',
        ref: 'v1.0',
        directory: 'packages/plugin',
        build: { kind: 'npm', script: 'build', outputDirectory: 'dist' },
      },
    })
    expect(resolvePluginCommandTimeout(request, null)).toBe(600_000)
    expect(resolvePluginCommandTimeout(request, 2000)).toBe(2000)
    expect(gitInstallInput(request.payload)).toEqual(request.payload)
  })
  it.each([
    [['source', 'sample'], 'query', 'plugin.source', { pluginId: 'sample' }],
    [['check', 'sample'], 'command', 'plugin.git.check', { pluginId: 'sample' }],
    [
      ['update', 'sample', '--ref', 'main'],
      'command',
      'plugin.git.update',
      { pluginId: 'sample', ref: 'main' },
    ],
    [['apply', 'candidate'], 'command', 'plugin.git.apply', { candidateId: 'candidate' }],
    [
      ['rollback', 'sample', 'revision'],
      'command',
      'plugin.rollback',
      { pluginId: 'sample', revision: 'revision' },
    ],
    [['discover', '--query', 'notes'], 'query', 'plugin.discover', { query: 'notes' }],
  ])('maps %j to a fixed facade operation', (args, kind, id, payload) => {
    expect(parsePluginCommand(['plugin', ...(args as string[])])).toEqual({ kind, id, payload })
  })
  it.each([
    ['install-git', 'url', '--build', 'shell'],
    ['install-git', 'url', '--script', 'arbitrary'],
    ['update', 'sample', '--ref', 'one', '--ref', 'two'],
    ['apply'],
    ['rollback', 'sample'],
    ['discover', 'url'],
  ])('rejects unsupported/incomplete CLI input %j', (...args) =>
    expect(() => parsePluginCommand(['plugin', ...args])).toThrow(),
  )
  it.each(['--upload-pack=bad', 'main~1', 'main..other', '$(command)', 'main;command'])(
    'rejects Git revision expressions %s',
    ref => expect(() => pluginGitRef(ref)).toThrow(),
  )
  it('rejects repository protocols, escaping package paths and unknown payload fields', () => {
    for (const input of [
      { repository: 'ext::command' },
      { repository: 'https://host/repo', directory: '../outside' },
      { repository: 'https://host/repo', extra: true },
    ]) {
      expect(() => gitInstallInput(input)).toThrow()
    }
  })
  it('resolves standard Windows npm and pnpm through Node with literal argument arrays', async () => {
    const exists = async (path: string) => path.endsWith('npm-cli.js') || path.endsWith('pnpm.cjs')
    expect(
      await resolvePluginBuildInvocation(
        'npm',
        'C:\\Tools\\npm.cmd',
        'win32',
        async () => 'C:\\Tools\\node.exe',
        exists,
      ),
    ).toEqual({
      command: 'C:\\Tools\\node.exe',
      args: ['C:\\Tools\\node_modules\\npm\\bin\\npm-cli.js'],
    })
    expect(
      await resolvePluginBuildInvocation(
        'pnpm',
        'C:\\Tools\\pnpm.cmd',
        'win32',
        async () => 'node.exe',
        exists,
      ),
    ).toEqual({ command: 'node.exe', args: ['C:\\Tools\\node_modules\\pnpm\\bin\\pnpm.cjs'] })
    await expect(
      resolvePluginBuildInvocation(
        'pnpm',
        'C:\\Tools\\pnpm.cmd',
        'win32',
        async () => 'node.exe',
        async () => false,
      ),
    ).rejects.toThrow('prebuilt')
  })
})
