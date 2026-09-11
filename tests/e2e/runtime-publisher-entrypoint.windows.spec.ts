import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'

test('runtime publisher dispatches from Windows short and long temporary paths', async () => {
  test.skip(process.platform !== 'win32', 'Windows short-path entrypoint regression')
  const root = await mkdtemp(join(tmpdir(), 'opencove-publisher-long-path-'))
  try {
    await copyFile(resolve('src/app/cli/publishRuntime.mjs'), join(root, 'publishRuntime.mjs'))
    const short = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:OPENCOVE_TEST_LONG_PATH).ShortPath',
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        env: { ...process.env, OPENCOVE_TEST_LONG_PATH: root },
      },
    )
    expect(short.status, short.stderr).toBe(0)
    const shortRoot = short.stdout.trim()
    const longRoot = await realpath(root)
    expect(await realpath(shortRoot)).toBe(longRoot)
    expect(shortRoot.toLowerCase()).not.toBe(longRoot.toLowerCase())
    for (const directory of [shortRoot, longRoot]) {
      const result = spawnSync(
        electronPath,
        [join(directory, 'publishRuntime.mjs'), 'missing', 'unused', 'invalid-digest'],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5000,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        },
      )
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('Invalid artifact digest.')
      expect(result.stdout).toBe('')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
