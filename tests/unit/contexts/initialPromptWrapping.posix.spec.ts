// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  }).resolveCommandSpawn({ cwd: '/tmp', command: inertReceiver(), args: ['--', text] })
  expect(
    execFileSync(spawn.command, spawn.args, { cwd: spawn.cwd, env: spawn.env })
      .toString('utf8')
      .split('\0'),
  ).toEqual(['--', text, ''])
})

/**
 * Prints every argv element after the script path, NUL-terminated. Unlike printf (GNU printf
 * drops "--"), Node never parses arguments that follow a script path, on any platform.
 */
function inertReceiver(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'opencove-receiver-')), 'receiver')
  writeFileSync(
    path,
    `#!${process.execPath}\nprocess.stdout.write(process.argv.slice(2).map(a => a + '\\0').join(''))\n`,
  )
  chmodSync(path, 0o755)
  return path
}
