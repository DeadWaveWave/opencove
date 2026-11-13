// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('@playwright/test', () => ({ _electron: { launch } }))

import { launchApp } from '../../e2e/workspace-canvas.app'

function createApp(firstWindowError?: Error) {
  return {
    process: () => ({ pid: undefined, exitCode: 0 }),
    close: vi.fn(async () => undefined),
    waitForEvent: vi.fn(async () => undefined),
    firstWindow: vi.fn(async () => {
      if (firstWindowError) {
        throw firstWindowError
      }
      return {
        waitForLoadState: vi.fn(async () => undefined),
        waitForFunction: vi.fn(async () => undefined),
      }
    }),
  }
}

describe('E2E app profile lifetime', () => {
  let userDataDir: string
  let seedPath: string

  beforeEach(async () => {
    launch.mockReset()
    vi.stubEnv('OPENCOVE_E2E_DISABLE_CRASH_FALLBACK', '0')
    vi.stubEnv('OPENCOVE_E2E_PIPE_ELECTRON_LOGS', '0')
    const root = path.resolve('artifacts/e2e-app-lifecycle')
    await mkdir(root, { recursive: true })
    userDataDir = await mkdtemp(path.join(root, 'profile-'))
    seedPath = path.join(userDataDir, 'workspace-state.json')
    await writeFile(seedPath, 'persisted task and agent binding')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('preserves restart state through failed launches until the successful app closes', async () => {
    const states: Array<string | null> = []
    const launchError = new Error('electronApplication.firstWindow: Timeout exceeded')
    const failedApp = createApp(launchError)
    const failedClose = failedApp.close
    launch.mockImplementation(async () => {
      states.push(await readFile(seedPath, 'utf8').catch(() => null))
      if (states.length === 1) {
        return failedApp
      }
      if (states.length === 2) {
        throw new Error('Process failed to launch')
      }
      return createApp()
    })

    const { electronApp } = await launchApp({
      windowMode: 'offscreen',
      userDataDir,
      cleanupUserDataDir: true,
    })
    try {
      expect(states).toEqual(Array(3).fill('persisted task and agent binding'))
      expect(failedClose).toHaveBeenCalled()
      expect(await readFile(seedPath, 'utf8')).toBe('persisted task and agent binding')
    } finally {
      await electronApp.close()
    }
    expect(existsSync(userDataDir)).toBe(false)
  })

  it.each([true, false])(
    'honors cleanupUserDataDir=%s after the complete launch fails',
    async cleanupUserDataDir => {
      const failure = new Error('fatal startup error')
      launch.mockResolvedValue(createApp(failure))
      await expect(
        launchApp({ windowMode: 'inactive', userDataDir, cleanupUserDataDir }),
      ).rejects.toThrow(failure)
      expect(existsSync(seedPath)).toBe(!cleanupUserDataDir)
    },
  )
})
