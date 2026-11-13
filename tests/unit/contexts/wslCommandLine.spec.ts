// @vitest-environment node
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { serializeWindowsArguments } from '../../../src/platform/process/windowsCommandLine'
import { preparePtySpawnArguments } from '../../../src/platform/process/spawnArguments'
import { windowsSpawnCommandLine } from '../../support/windowsPlatformReceiver'
import { parseWslCommandLine } from '../../support/wslCommandLine'

const require = createRequire(import.meta.url)
const { argsToCommandLine } = require('node-pty/lib/windowsPtyAgent.js') as {
  argsToCommandLine(file: string, args: string | string[]): string
}
const resolver = new TerminalProfileResolver({
  platform: 'win32',
  env: () => ({}),
  homeDir: () => 'C:\\Users\\fixture',
  processCwd: () => 'C:\\project',
  locateWindowsCommands: async () => [],
  listWslDistros: async () => ['Ubuntu'],
})
it.each([
  'update',
  'plugins',
  ' --agent-teams ',
  '$(printf update)',
  '`printf update`',
  'Explain " --agent-teams " please',
  'spaces and 中文 😀',
  'C:\\a\\',
  'a\\"b',
  '',
  '\n\r\t',
])('real resolver and node-pty preserve WSL direct exec for %j', async prompt => {
  const plan = await resolver.resolveCommandSpawn({
    cwd: 'C:\\project folder',
    profileId: 'wsl:Ubuntu',
    command: '/usr/bin/printf',
    args: ['%s', prompt],
  })
  const received = parseWslCommandLine(windowsSpawnCommandLine(plan.command, plan.args))
  expect(received).toMatchObject({
    mode: 'exec',
    distro: 'Ubuntu',
    cwd: '/mnt/c/project folder',
    switches: ['--distribution', '--cd', '--exec'],
    argv: ['/usr/bin/printf', '%s', prompt],
  })
  if (process.platform !== 'win32') {
    expect(execFileSync(received.argv[0], received.argv.slice(1), { encoding: 'utf8' })).toBe(
      prompt,
    )
  }
})
it('negative control: CRT-quoting WSL switches selects shell and evaluates substitution', () => {
  const line = argsToCommandLine(
    'wsl.exe',
    serializeWindowsArguments([
      '--distribution',
      'Ubuntu',
      '--exec',
      '/usr/bin/printf',
      '%s',
      '$(printf update)',
    ]),
  )
  const received = parseWslCommandLine(line)
  expect(received).toMatchObject({ mode: 'shell', switches: [], argv: [] })
  // The first quoted option is now a shell command. An inert function accepts that
  // command name and prints its final operand, demonstrating the extra evaluation.
  if (process.platform !== 'win32') {
    expect(
      execFileSync(
        '/bin/bash',
        ['-c', `function --distribution() { printf %s "\${@: -1}"; }; ${received.shell}`],
        { encoding: 'utf8' },
      ),
    ).toBe('update')
  }
})
it('uses WSL directory quoting rather than CRT trailing-backslash escaping', () => {
  const args = [
    '--distribution',
    'Ubuntu',
    '--cd',
    'C:\\folder space\\',
    '--exec',
    '/a path\\',
    'a\\"b',
  ]
  const received = parseWslCommandLine(
    windowsSpawnCommandLine('C:\\Windows\\System32\\wsl.exe', args),
  )
  expect(received).toMatchObject({
    mode: 'exec',
    cwd: 'C:\\folder space\\',
    argv: ['/a path\\', 'a\\"b'],
  })
})
it('keeps a distribution value named --exec out of the executable suffix', () => {
  const received = parseWslCommandLine(
    windowsSpawnCommandLine('WSL.EXE', ['--distribution', '--exec', '-e', 'receiver', 'text']),
  )
  expect(received).toMatchObject({ distro: '--exec', mode: 'exec', argv: ['receiver', 'text'] })
})
it('preserves an interactive WSL profile without adding an executable or shell command', () => {
  const received = parseWslCommandLine(
    windowsSpawnCommandLine('wsl.exe', ['--distribution', 'Ubuntu', '--cd', '/home/a b']),
  )
  expect(received).toMatchObject({ mode: 'shell', shell: '', distro: 'Ubuntu', cwd: '/home/a b' })
})
it.each([
  ['--distribution', 'Ubuntu two', '--exec', 'receiver'],
  ['--distribution', '"Ubuntu"', '--exec', 'receiver'],
  ['--cd', '/a"b', '--exec', 'receiver'],
  ['--exec', '/a"b'],
])('refuses an unrepresentable WSL prefix instead of falling back to a shell: %j', (...args) => {
  expect(() => preparePtySpawnArguments('wsl.exe', args, 'C:\\project', 'win32')).toThrow()
})

it.each(['command', 'terminal'] as const)(
  'preserves corrective guidance before dispatching a %s WSL launch',
  async kind => {
    const invalid = new TerminalProfileResolver({
      platform: 'win32',
      env: () => ({}),
      locateWindowsCommands: async () => [],
      listWslDistros: async () => ['Ubuntu two'],
    })
    const request = { cwd: 'C:\\project', profileId: 'wsl:Ubuntu two' }
    const launch =
      kind === 'command'
        ? invalid.resolveCommandSpawn({ ...request, command: 'receiver', args: ['text'] })
        : invalid.resolveTerminalSpawn(request)
    await expect(launch).rejects.toMatchObject({
      code: 'common.invalid_input',
      details: { reason: 'wsl_arguments_unsupported' },
    })
  },
)
