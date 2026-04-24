import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHomeWorkerEndpointResolver } from '../../../src/app/main/worker/homeWorkerEndpointResolver'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../src/shared/constants/controlSurface'

describe('home worker endpoint resolver', () => {
  let userDataDir: string | null = null

  afterEach(async () => {
    if (!userDataDir) {
      return
    }

    await rm(userDataDir, { recursive: true, force: true })
    userDataDir = null
  })

  async function createTempUserDataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'opencove-test-home-worker-endpoint-'))
    userDataDir = dir
    return dir
  }

  async function writeWorkerConnection(
    dir: string,
    overrides?: Partial<Record<string, unknown>>,
  ): Promise<void> {
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify({
        version: 1,
        pid: process.pid,
        hostname: '127.0.0.1',
        port: 4310,
        token: 'token-1',
        createdAt: new Date().toISOString(),
        ...overrides,
      })}\n`,
      'utf8',
    )
  }

  it('re-reads the local worker connection file on each resolve', async () => {
    const dir = await createTempUserDataDir()
    const resolver = createHomeWorkerEndpointResolver({
      userDataPath: dir,
      config: {
        version: 1,
        mode: 'local',
        remote: null,
        updatedAt: null,
      },
      effectiveMode: 'local',
    })

    await writeWorkerConnection(dir)
    await expect(resolver()).resolves.toEqual({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    })

    await writeWorkerConnection(dir, { port: 56277, token: 'token-2' })
    await expect(resolver()).resolves.toEqual({
      hostname: '127.0.0.1',
      port: 56277,
      token: 'token-2',
    })
  })

  it('keeps using the startup endpoint until the local worker connection file appears', async () => {
    const dir = await createTempUserDataDir()
    const resolver = createHomeWorkerEndpointResolver({
      userDataPath: dir,
      config: {
        version: 1,
        mode: 'local',
        remote: null,
        updatedAt: null,
      },
      effectiveMode: 'local',
      initialEndpoint: {
        hostname: '127.0.0.1',
        port: 4311,
        token: 'startup-token',
      },
    })

    await expect(resolver()).resolves.toEqual({
      hostname: '127.0.0.1',
      port: 4311,
      token: 'startup-token',
    })

    await writeWorkerConnection(dir, { port: 56278, token: 'file-token' })
    await expect(resolver()).resolves.toEqual({
      hostname: '127.0.0.1',
      port: 56278,
      token: 'file-token',
    })
  })

  it('returns the saved remote endpoint for remote mode', async () => {
    const dir = await createTempUserDataDir()
    const resolver = createHomeWorkerEndpointResolver({
      userDataPath: dir,
      config: {
        version: 1,
        mode: 'remote',
        remote: { hostname: 'remote.example', port: 7443, token: 'remote-token' },
        updatedAt: null,
      },
      effectiveMode: 'remote',
    })

    await expect(resolver()).resolves.toEqual({
      hostname: 'remote.example',
      port: 7443,
      token: 'remote-token',
    })
  })
})
