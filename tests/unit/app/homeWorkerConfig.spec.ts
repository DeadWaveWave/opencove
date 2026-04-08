import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenCoveAppError } from '../../../src/shared/errors/appError'
import {
  readHomeWorkerConfig,
  setHomeWorkerConfig,
  setHomeWorkerWebUiSettings,
} from '../../../src/app/main/worker/homeWorkerConfig'

describe('home worker config', () => {
  let userDataDir: string | null = null

  afterEach(async () => {
    if (!userDataDir) {
      return
    }

    await rm(userDataDir, { recursive: true, force: true })
    userDataDir = null
  })

  async function createTempUserDataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'opencove-test-home-worker-'))
    userDataDir = dir
    return dir
  }

  it('returns defaults when config is missing', async () => {
    const dir = await createTempUserDataDir()
    const config = await readHomeWorkerConfig(dir)
    expect(config).toEqual({
      version: 1,
      mode: 'standalone',
      remote: null,
      webUi: {
        enabled: false,
        port: null,
        exposeOnLan: false,
        passwordSet: false,
      },
      updatedAt: null,
    })
  })

  it('persists and loads remote config', async () => {
    const dir = await createTempUserDataDir()
    const saved = await setHomeWorkerConfig(dir, {
      mode: 'remote',
      remote: { hostname: 'example.com', port: 1234, token: 'token123' },
    })

    expect(saved.mode).toBe('remote')
    expect(saved.remote).toEqual({ hostname: 'example.com', port: 1234, token: 'token123' })
    expect(saved.updatedAt).toEqual(expect.any(String))

    const loaded = await readHomeWorkerConfig(dir)
    expect(loaded.mode).toBe('remote')
    expect(loaded.remote).toEqual({ hostname: 'example.com', port: 1234, token: 'token123' })
  })

  it('rejects remote mode without remote endpoint', async () => {
    const dir = await createTempUserDataDir()
    await expect(
      setHomeWorkerConfig(dir, {
        mode: 'remote',
        remote: null,
      }),
    ).rejects.toBeInstanceOf(OpenCoveAppError)
  })

  it('persists web ui settings', async () => {
    const dir = await createTempUserDataDir()

    const saved = await setHomeWorkerWebUiSettings(dir, { enabled: true, port: 16661 })
    expect(saved.webUi.enabled).toBe(true)
    expect(saved.webUi.port).toBe(16661)

    const loaded = await readHomeWorkerConfig(dir)
    expect(loaded.webUi.enabled).toBe(true)
    expect(loaded.webUi.port).toBe(16661)
  })

  it('normalizes port 0 to random', async () => {
    const dir = await createTempUserDataDir()

    const saved = await setHomeWorkerWebUiSettings(dir, { enabled: true, port: 0 })
    expect(saved.webUi.port).toBeNull()
  })

  it('rejects invalid web ui port', async () => {
    const dir = await createTempUserDataDir()

    await expect(
      setHomeWorkerWebUiSettings(dir, { enabled: true, port: 70_000 }),
    ).rejects.toBeInstanceOf(OpenCoveAppError)
  })
})
