// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PassThrough } from 'node:stream'

const { launch, testInfo } = vi.hoisted(() => ({
  launch: vi.fn(),
  testInfo: { outputPath: vi.fn(), attach: vi.fn(async () => undefined) },
}))
vi.mock('@playwright/test', () => ({
  _electron: { launch },
  test: { info: () => testInfo },
}))

import { launchApp } from '../../e2e/workspace-canvas.app'

function createApp(firstWindowError?: Error) {
  const child = {
    pid: undefined,
    exitCode: 0,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  }
  return {
    process: vi.fn(() => child),
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
  let attachmentsDir: string

  beforeEach(async () => {
    launch.mockReset()
    vi.stubEnv('OPENCOVE_E2E_DISABLE_CRASH_FALLBACK', '0')
    vi.stubEnv('OPENCOVE_E2E_PIPE_ELECTRON_LOGS', '0')
    const root = path.resolve('artifacts/e2e-app-lifecycle')
    await mkdir(root, { recursive: true })
    userDataDir = await mkdtemp(path.join(root, 'profile-'))
    attachmentsDir = `${userDataDir}-attachments`
    testInfo.outputPath.mockImplementation(name => path.join(attachmentsDir, name))
    testInfo.attach.mockClear()
    seedPath = path.join(userDataDir, 'workspace-state.json')
    await writeFile(seedPath, 'persisted task and agent binding')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(attachmentsDir, { recursive: true, force: true })
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

  it.each([true, false])(
    'retains diagnostics after disconnection and honors cleanupUserDataDir=%s',
    async cleanupUserDataDir => {
      const app = createApp()
      const child = app.process()
      const nativeClose = app.close
      launch.mockResolvedValue(app)
      const { electronApp } = await launchApp({ userDataDir, cleanupUserDataDir })
      const crash = JSON.stringify({
        event: 'render-process-gone',
        details: { reason: 'crashed', exitCode: 7 },
      })
      child.stderr.write(`native renderer crash\n${crash}\n`)
      await mkdir(path.join(userDataDir, 'logs'))
      await writeFile(
        path.join(userDataDir, 'logs/runtime-diagnostics.log'),
        `disk-only crash evidence\n${crash}`,
      )

      const disconnected = new TypeError("Cannot read properties of undefined (reading '_object')")
      app.process.mockImplementation(() => {
        throw disconnected
      })
      app.waitForEvent.mockImplementation(() => {
        throw disconnected
      })
      nativeClose.mockImplementation(() => {
        throw disconnected
      })
      const primaryFailure = new Error('primary renderer failure')
      await expect(
        (async () => {
          try {
            throw primaryFailure
          } finally {
            await electronApp.close()
          }
        })(),
      ).rejects.toBe(primaryFailure)
      await expect(electronApp.close()).resolves.toBeUndefined()

      expect(nativeClose).toHaveBeenCalledTimes(1)
      const outputPath = path.join(attachmentsDir, 'electron-process-diagnostics-null.log')
      expect(testInfo.attach).toHaveBeenCalledExactlyOnceWith('electron-process-diagnostics', {
        path: outputPath,
        contentType: 'text/plain',
      })
      const output = await readFile(outputPath, 'utf8')
      expect(output).toContain('native renderer crash')
      expect(output).toContain('disk-only crash evidence')
      expect(output).toContain(
        `[runtime diagnostics, including startup before Playwright connected]\n`,
      )
      expect(output).toContain(crash)
      expect(existsSync(seedPath)).toBe(!cleanupUserDataDir)
    },
  )

  it('keeps the primary failure and cleans the profile if attaching diagnostics fails', async () => {
    launch.mockResolvedValue(createApp())
    const { electronApp } = await launchApp({ userDataDir })
    testInfo.attach.mockRejectedValueOnce(new Error('attachment unavailable'))
    const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const primaryFailure = new Error('primary test failure')
    await expect(
      (async () => {
        try {
          throw primaryFailure
        } finally {
          await electronApp.close()
        }
      })(),
    ).rejects.toBe(primaryFailure)
    expect(existsSync(userDataDir)).toBe(false)
    expect(output).toHaveBeenCalledWith(expect.stringContaining('attachment unavailable'))
    expect(output).toHaveBeenCalledWith(expect.stringContaining('[runtime diagnostics'))
  })
})
