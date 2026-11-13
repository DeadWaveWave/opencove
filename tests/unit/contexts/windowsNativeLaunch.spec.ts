// @vitest-environment node
import { expect, it } from 'vitest'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { receivePowerShellSpawn } from '../../support/windowsPlatformReceiver'
it('keeps a fixed small launcher and owns payload env even with case-insensitive collisions', async () => {
  const resolver = new TerminalProfileResolver({
    platform: 'win32',
    env: () => ({ opencove_native_arguments: 'unsafe', OPENCOVE_NATIVE_COMMAND: 'other.exe' }),
    locateWindowsCommands: async () => [],
    listWslDistros: async () => [],
    homeDir: () => 'C:\\Users\\test',
  })
  const short = await resolver.resolveCommandSpawn({
    cwd: 'C:\\project',
    command: 'claude.exe',
    args: ['--', '"update"'],
  })
  const prompt = '中文 " \\ --agent-teams '.repeat(700)
  const long = await resolver.resolveCommandSpawn({
    cwd: 'C:\\project',
    command: 'claude.exe',
    args: ['--', prompt],
  })
  expect(long.args).toEqual(short.args)
  expect(long.args.join(' ').length).toBeLessThan(32_767)
  expect(long.env.opencove_native_arguments).toBeUndefined()
  expect(receivePowerShellSpawn(long.command, long.args, long.env)).toEqual([
    'claude.exe',
    '--',
    prompt,
  ])
  expect(long.publicCommand).toEqual({ command: 'claude.exe', args: ['--', prompt] })
})
