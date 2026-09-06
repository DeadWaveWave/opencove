import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import electronPath from 'electron'

test('managed runtime verification exits after native PTY completion on Windows', () => {
  test.skip(process.platform !== 'win32', 'Windows ConPTY worker lifetime regression')
  const result = spawnSync(electronPath, [resolve('out/main/managedRuntime.js'), 'verify'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  const identity = JSON.parse(result.stdout)
  expect(identity.platform).toBe('win32')
  expect(identity.build.buildId).toMatch(/^[a-f0-9]{64}$/)
})
