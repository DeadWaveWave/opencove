// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { startTestCrashReporter } from '../../../src/app/main/runtimeDiagnostics'

const electron = vi.hoisted(() => ({
  app: { getPath: vi.fn(), setPath: vi.fn() },
  crashReporter: { start: vi.fn() },
}))
vi.mock('electron', () => electron)
const nativePlatform = process.platform

describe('test-only crash capture', () => {
  let profile: string
  beforeEach(async () => {
    const root = resolve('artifacts/crash-reporter-unit')
    await mkdir(root, { recursive: true })
    profile = await mkdtemp(join(root, 'profile-'))
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('OPENCOVE_TEST_USER_DATA_DIR', profile)
    electron.app.getPath.mockReturnValue(profile)
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    Object.defineProperty(process, 'platform', { value: nativePlatform })
    await rm(profile, { recursive: true, force: true })
  })

  it.each(['production', 'development'])('does nothing in %s even with a test path', env => {
    vi.stubEnv('NODE_ENV', env)
    startTestCrashReporter()
    expect(electron.app.setPath).not.toHaveBeenCalled()
    expect(electron.crashReporter.start).not.toHaveBeenCalled()
  })

  it('requires an isolated test profile', () => {
    vi.stubEnv('OPENCOVE_TEST_USER_DATA_DIR', '')
    startTestCrashReporter()
    expect(electron.app.setPath).not.toHaveBeenCalled()
    expect(electron.crashReporter.start).not.toHaveBeenCalled()
  })

  it.each(['darwin', 'linux'])('does not start Crashpad on %s test launches', platform => {
    Object.defineProperty(process, 'platform', { value: platform })
    startTestCrashReporter()
    expect(electron.app.setPath).not.toHaveBeenCalled()
    expect(electron.crashReporter.start).not.toHaveBeenCalled()
  })

  it('creates the profile-owned dump directory before starting offline Crashpad', async () => {
    startTestCrashReporter()
    const dumps = join(profile, 'crashDumps')
    expect((await stat(dumps)).isDirectory()).toBe(true)
    expect(electron.app.setPath).toHaveBeenCalledWith('crashDumps', dumps)
    expect(electron.app.setPath.mock.invocationCallOrder[0]).toBeLessThan(
      electron.crashReporter.start.mock.invocationCallOrder[0],
    )
    expect(electron.crashReporter.start).toHaveBeenCalledExactlyOnceWith({
      uploadToServer: false,
      ignoreSystemCrashHandler: true,
    })
  })
})
