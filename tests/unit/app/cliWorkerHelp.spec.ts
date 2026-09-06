// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { runCommand } from '../../../src/platform/process/runCommand'

it('worker start --help exits without a Worker or profile, even with runtime launch flags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-help-regression-'))
  try {
    const result = await runCommand(
      process.execPath,
      [
        resolve('src/app/cli/opencove.mjs'),
        'worker',
        'start',
        '--help',
        '--user-data',
        join(root, 'profile'),
        '--port',
        '45001',
        '--token=--help-fixture',
      ],
      root,
      {
        timeoutMs: 3_000,
        env: {
          ...process.env,
          HOME: root,
          XDG_CONFIG_HOME: root,
          APPDATA: root,
          LOCALAPPDATA: root,
        },
      },
    )
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('worker start')
    expect(result.stdout).not.toContain('"pid"')
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
