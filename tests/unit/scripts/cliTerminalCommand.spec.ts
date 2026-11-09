// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { terminalExitStatus } from '../../support/cliTerminalCommand'

it.each([0, 7])('delimits unterminated command output and preserves exit %s', exitCode => {
  const windows = process.platform === 'win32'
  const command = windows
    ? `[Console]::Write('payload7'); cmd /c exit ${exitCode}; ${terminalExitStatus('win32')}`
    : `printf 'payload7'; (exit ${exitCode}); ${terminalExitStatus(process.platform)}`
  const result = spawnSync(
    windows ? 'powershell.exe' : '/bin/sh',
    windows ? ['-NoProfile', '-Command', command] : ['-c', command],
    { encoding: 'utf8' },
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stdout.replaceAll('\r', '')).toBe(`payload7\nexit=${exitCode}\n`)
  expect(result.stdout).toMatch(new RegExp(`\\bexit=${exitCode}\\b`))
})
