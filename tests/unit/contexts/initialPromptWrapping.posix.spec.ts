// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
it
  .runIf(process.platform !== 'win32')
  .each([
    '"update"',
    'plugins',
    ' --agent-teams ',
    '$(printf update)',
    '" --agent-teams "',
    '中文 😀',
    'C:\\tail\\',
    'a\r\n"b"',
  ])('delivers %j unchanged to an inert native POSIX receiver', async text => {
  const spawn = await new TerminalProfileResolver({
    platform: process.platform,
  }).resolveCommandSpawn({ cwd: '/tmp', command: '/usr/bin/printf', args: ['%s\\000', '--', text] })
  expect(
    execFileSync(spawn.command, spawn.args, { cwd: spawn.cwd, env: spawn.env })
      .toString('utf8')
      .split('\0'),
  ).toEqual(['--', text, ''])
})
