import { execFile } from 'node:child_process'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { hydrateCliEnvironmentForAppLaunch } from '../../../src/platform/os/CliEnvironment'
import { disposeCommandEnvironmentService } from '../../../src/platform/os/CommandEnvironmentService'
import { disposeShellEnvironmentService } from '../../../src/platform/os/ShellEnvironmentService'

const execFileAsync = promisify(execFile)
const ORIGINAL_ENV = { ...process.env }

async function hasExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  disposeCommandEnvironmentService()
  disposeShellEnvironmentService()
})

describe('CliEnvironment hydration', () => {
  it('hydrates PATH so worker/git invocations can resolve git', async () => {
    if (process.platform === 'win32') {
      return
    }

    const originalPath = process.env.PATH

    try {
      process.env.NODE_ENV = 'production'
      process.env.PATH = '/nonexistent'

      await expect(execFileAsync('git', ['--version'], { env: process.env })).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      )

      await hydrateCliEnvironmentForAppLaunch(true)

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

  it('hydrates PATH from an interactive zsh env so shebang-based CLIs can resolve node', async () => {
    if (process.platform === 'win32') {
      return
    }

    if (!(await hasExecutable('/bin/zsh'))) {
      return
    }

    const fixtureRoot = await mkdtemp(join(tmpdir(), 'opencove-cli-env-'))
    const fakeBinDir = join(fixtureRoot, 'fakebin')
    const codexPath = join(fakeBinDir, 'codex')

    try {
      await mkdir(fakeBinDir, { recursive: true })
      await writeFile(join(fixtureRoot, '.zprofile'), '# intentionally empty\n', 'utf8')
      await writeFile(join(fixtureRoot, '.zshrc'), `export PATH="${fakeBinDir}:$PATH"\n`, 'utf8')
      await writeFile(join(fakeBinDir, 'node'), '#!/bin/sh\necho fake-node-ran\n', {
        encoding: 'utf8',
        mode: 0o755,
      })
      await writeFile(
        join(fakeBinDir, 'codex'),
        '#!/usr/bin/env node\nconsole.log("fake-codex")\n',
        {
          encoding: 'utf8',
          mode: 0o755,
        },
      )

      process.env.NODE_ENV = 'production'
      process.env.SHELL = '/bin/zsh'
      process.env.ZDOTDIR = fixtureRoot
      process.env.PATH = '/usr/bin:/bin'
      delete process.env.OPENCOVE_TRUST_PROCESS_ENV

      await expect(execFileAsync(codexPath, [], { env: process.env })).rejects.toMatchObject({
        code: 127,
      })

      await hydrateCliEnvironmentForAppLaunch(true)

      const result = await execFileAsync(codexPath, [], { env: process.env })
      const stdout = typeof result.stdout === 'string' ? result.stdout : result.stdout.toString()
      expect(process.env.PATH?.split(':')).toContain(fakeBinDir)
      expect(stdout.trim()).toBe('fake-node-ran')
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})
