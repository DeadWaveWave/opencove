import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { hydrateCliEnvironmentForAppLaunch } from '../../../src/platform/os/CliEnvironment'

const execFileAsync = promisify(execFile)

describe('CliEnvironment hydration', () => {
  it('hydrates PATH so worker/git invocations can resolve git', async () => {
    if (process.platform === 'win32') {
      return
    }

    const originalPath = process.env.PATH

    try {
      process.env.PATH = '/nonexistent'

      await expect(execFileAsync('git', ['--version'], { env: process.env })).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      )

      hydrateCliEnvironmentForAppLaunch(true)

      const result = await execFileAsync('git', ['--version'], { env: process.env })
      const stdout = typeof result.stdout === 'string' ? result.stdout : result.stdout.toString()
      expect(stdout).toMatch(/git version/i)
    } finally {
      if (typeof originalPath === 'string') {
        process.env.PATH = originalPath
      } else {
        delete process.env.PATH
      }
    }
  })
})
