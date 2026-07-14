import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../src/shared/constants/controlSurface'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../src/shared/contracts/controlSurface'

let userDataDir: string | null = null
let appPath: string | null = null
const { spawnMock, removeConnectionFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  removeConnectionFileMock: vi.fn(),
}))
const { isReusableLocalWorkerConnectionMock } = vi.hoisted(() => ({
  isReusableLocalWorkerConnectionMock: vi.fn(),
}))
const { readRuntimeAppVersionMock } = vi.hoisted(() => ({
  readRuntimeAppVersionMock: vi.fn(() => 'test-version'),
}))

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: spawnMock,
    default: { ...actual, spawn: spawnMock },
  }
})

vi.mock('electron', () => {
  return {
    app: {
      getPath: (name: string) => {
        if (name !== 'userData') {
          throw new Error(`Unexpected electron.app.getPath(${name})`)
        }

        if (!userDataDir) {
          throw new Error('Test userDataDir is not set')
        }

        return userDataDir
      },
      getAppPath: () => appPath ?? '/mock/app/path',
    },
  }
})

vi.mock('../../../src/app/main/controlSurface/http/connectionFile', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../src/app/main/controlSurface/http/connectionFile')
    >()

  return {
    ...actual,
    removeConnectionFile: async (userDataPath: string, fileName: string) => {
      removeConnectionFileMock(userDataPath, fileName)
      return await actual.removeConnectionFile(userDataPath, fileName)
    },
  }
})

vi.mock('../../../src/app/main/worker/localWorkerCompatibility', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/app/main/worker/localWorkerCompatibility')>()
  isReusableLocalWorkerConnectionMock.mockImplementation(actual.isReusableLocalWorkerConnection)

  return {
    ...actual,
    isReusableLocalWorkerConnection: isReusableLocalWorkerConnectionMock,
  }
})

vi.mock('../../../src/app/main/controlSurface/runtimeAppVersion', () => ({
  readRuntimeAppVersion: readRuntimeAppVersionMock,
}))

import {
  getLocalWorkerStatus,
  repairStaleLocalWorkerFiles,
  startLocalWorker,
  stopOwnedLocalWorker,
} from '../../../src/app/main/worker/localWorkerManager'

describe('local worker manager connection file', () => {
  afterEach(async () => {
    spawnMock.mockReset()
    removeConnectionFileMock.mockReset()
    vi.unstubAllGlobals()
    readRuntimeAppVersionMock.mockReset()
    readRuntimeAppVersionMock.mockReturnValue('test-version')
    await stopOwnedLocalWorker().catch(() => undefined)

    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true })
    }

    userDataDir = null
    appPath = null
  })

  async function createTempUserDataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'opencove-test-local-worker-'))
    userDataDir = dir
    appPath = dir
    return dir
  }

  function createConnectionInfo(
    overrides?: Partial<Record<string, unknown>>,
  ): Record<string, unknown> {
    return {
      version: 1,
      pid: process.pid,
      hostname: '127.0.0.1',
      port: 4321,
      token: 'token123',
      createdAt: new Date().toISOString(),
      appVersion: 'test-version',
      startedBy: 'cli',
      ...overrides,
    }
  }
  type TestWorkerChild = EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    killed: boolean
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    kill: () => boolean
  }
  function createWorkerChild(): TestWorkerChild {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      exitCode: null,
      signalCode: null,
    }) as TestWorkerChild
    child.kill = vi.fn(() => {
      child.killed = true
      child.exitCode = 0
      child.emit('exit', 0)
      return true
    })
    return child
  }
  function emitWorkerReady(child: TestWorkerChild): void {
    setTimeout(() => child.stdout.write(`${JSON.stringify(createConnectionInfo())}\n`), 0)
  }

  function emitWorkerExit(child: TestWorkerChild): void {
    setTimeout(() => {
      child.emit('exit', 1)
    }, 0)
  }

  async function createWorkerBuildEntry(): Promise<void> {
    const workerScriptPath = resolve(appPath!, 'out', 'main', 'worker.js')
    await mkdir(dirname(workerScriptPath), { recursive: true })
    await writeFile(workerScriptPath, '// test worker entry\n', 'utf8')
  }

  function stubWorkerHealthFetch(options?: {
    appVersion?: string
    endpointList?: 'available' | 'missing'
  }): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const requestId = body.length > 0 ? (JSON.parse(body) as { id?: string }).id : ''
      const response = (ok: boolean, value: unknown, status = 200) =>
        new Response(JSON.stringify({ __opencoveControlEnvelope: true, ok, value }), {
          status,
          headers: { 'content-type': 'application/json' },
        })

      if (requestId === 'system.ping') {
        return response(true, { ok: true, now: new Date().toISOString(), pid: process.pid })
      }
      if (requestId === 'system.capabilities') {
        return response(true, {
          protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
          appVersion: options?.appVersion ?? 'test-version',
        })
      }
      if (requestId === 'endpoint.list' && options?.endpointList === 'missing') {
        return response(
          false,
          {
            code: 'common.invalid_input',
            debugMessage: 'Unknown control surface query: endpoint.list',
          },
          400,
        )
      }
      return response(true, { endpoints: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('ignores Desktop control surface connection files', async () => {
    const dir = await createTempUserDataDir()
    await writeFile(
      resolve(dir, 'control-surface.json'),
      `${JSON.stringify(createConnectionInfo())}\n`,
      'utf8',
    )

    await expect(getLocalWorkerStatus()).resolves.toEqual({
      status: 'stopped',
      connection: null,
    })
  })

  it('uses the worker connection file', async () => {
    const dir = await createTempUserDataDir()
    const info = createConnectionInfo()
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(info)}\n`,
      'utf8',
    )

    stubWorkerHealthFetch()

    const status = await getLocalWorkerStatus()
    expect(status.status).toBe('running')
    if (status.status !== 'running') {
      return
    }

    expect(status.connection).toEqual(info)
  })

  it('treats Desktop-started worker connections from another app version as stale', async () => {
    const dir = await createTempUserDataDir()
    const info = createConnectionInfo({ startedBy: 'desktop', appVersion: 'old-version' })
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(info)}\n`,
      'utf8',
    )

    const fetchMock = vi.fn(async () => {
      throw new Error('version-mismatched worker should not be pinged')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getLocalWorkerStatus()).resolves.toEqual({
      status: 'stopped',
      connection: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats Desktop-started workers reporting another app version as stale', async () => {
    const dir = await createTempUserDataDir()
    const info = createConnectionInfo({ startedBy: 'desktop', appVersion: 'test-version' })
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(info)}\n`,
      'utf8',
    )

    const fetchMock = stubWorkerHealthFetch({ appVersion: 'old-version' })

    await expect(getLocalWorkerStatus()).resolves.toEqual({
      status: 'stopped',
      connection: null,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats legacy Desktop-started worker connections without appVersion as stale', async () => {
    const dir = await createTempUserDataDir()
    const info = createConnectionInfo({ startedBy: 'desktop', appVersion: undefined })
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(info)}\n`,
      'utf8',
    )

    const fetchMock = vi.fn(async () => {
      throw new Error('legacy desktop worker should not be pinged')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getLocalWorkerStatus()).resolves.toEqual({
      status: 'stopped',
      connection: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats legacy worker connections without owner metadata as stale', async () => {
    const dir = await createTempUserDataDir()
    const info = createConnectionInfo({ startedBy: undefined, appVersion: undefined })
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(info)}\n`,
      'utf8',
    )

    const fetchMock = vi.fn(async () => {
      throw new Error('legacy worker without owner metadata should not be pinged')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getLocalWorkerStatus()).resolves.toEqual({
      status: 'stopped',
      connection: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats workers missing endpoint list as stopped', async () => {
    const dir = await createTempUserDataDir()
    const info = createConnectionInfo()
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(info)}\n`,
      'utf8',
    )

    stubWorkerHealthFetch({ endpointList: 'missing' })

    await expect(getLocalWorkerStatus()).resolves.toEqual({
      status: 'stopped',
      connection: null,
    })
  })

  it('removes stale connection and lock files during repair', async () => {
    const dir = await createTempUserDataDir()
    const staleInfo = createConnectionInfo({ pid: 999_999, port: 4321 })
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(staleInfo)}\n`,
      'utf8',
    )
    await writeFile(
      resolve(dir, 'opencove-worker.lock'),
      `${JSON.stringify({ pid: process.pid, createdAt: new Date(0).toISOString() })}\n`,
      'utf8',
    )

    await repairStaleLocalWorkerFiles(dir, 999_999)

    await expect(readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')).rejects.toBeDefined()
    await expect(
      readFile(resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE), 'utf8'),
    ).rejects.toBeDefined()
  })

  it('repairs legacy worker files before starting a replacement worker', async () => {
    const dir = await createTempUserDataDir()
    const legacyInfo = createConnectionInfo({
      pid: 999_999,
      startedBy: undefined,
      appVersion: undefined,
    })
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(legacyInfo)}\n`,
      'utf8',
    )
    await writeFile(
      resolve(dir, 'opencove-worker.lock'),
      `${JSON.stringify({ pid: 999_999, createdAt: new Date(0).toISOString() })}\n`,
      'utf8',
    )

    const fetchMock = vi.fn(async () => {
      throw new Error('legacy worker should not be pinged before replacement')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(startLocalWorker()).rejects.toThrow(
      'Run `pnpm build` once before using Worker/Web UI in dev.',
    )

    expect(fetchMock).not.toHaveBeenCalled()
    await expect(readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')).rejects.toBeDefined()
    await expect(
      readFile(resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE), 'utf8'),
    ).rejects.toBeDefined()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('shares concurrent successful starts and allows a later fresh start', async () => {
    await createTempUserDataDir()
    await createWorkerBuildEntry()
    isReusableLocalWorkerConnectionMock.mockReset()
    isReusableLocalWorkerConnectionMock.mockResolvedValue(true)

    const firstChild = createWorkerChild()
    const secondChild = createWorkerChild()
    spawnMock.mockImplementationOnce(() => {
      emitWorkerReady(firstChild)
      return firstChild
    })
    spawnMock.mockImplementationOnce(() => {
      emitWorkerReady(secondChild)
      return secondChild
    })

    const firstStart = startLocalWorker()
    const concurrentStart = startLocalWorker()

    await expect(Promise.all([firstStart, concurrentStart])).resolves.toEqual([
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ status: 'running' }),
    ])
    expect(concurrentStart).toBe(firstStart)
    expect(spawnMock).toHaveBeenCalledTimes(1)

    const laterStart = startLocalWorker()
    expect(laterStart).not.toBe(firstStart)
    await expect(laterStart).resolves.toEqual(expect.objectContaining({ status: 'running' }))
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('shares stale-file repair and one retry across concurrent starts', async () => {
    const dir = await createTempUserDataDir()
    await createWorkerBuildEntry()
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(createConnectionInfo({ pid: 999_999, startedBy: 'desktop' }))}\n`,
      'utf8',
    )
    isReusableLocalWorkerConnectionMock.mockReset()
    isReusableLocalWorkerConnectionMock.mockResolvedValueOnce(false).mockResolvedValue(true)

    const failedChild = createWorkerChild()
    spawnMock.mockImplementationOnce(() => {
      emitWorkerExit(failedChild)
      return failedChild
    })
    spawnMock.mockImplementation(() => {
      const retryChild = createWorkerChild()
      emitWorkerReady(retryChild)
      return retryChild
    })

    const firstStart = startLocalWorker()
    const concurrentStart = startLocalWorker()

    await expect(Promise.all([firstStart, concurrentStart])).resolves.toEqual([
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ status: 'running' }),
    ])
    expect(concurrentStart).toBe(firstStart)
    expect(removeConnectionFileMock).toHaveBeenCalledTimes(2)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('clears a rejected shared start before a later explicit retry', async () => {
    await createTempUserDataDir()

    const firstStart = startLocalWorker()
    const concurrentStart = startLocalWorker()

    await Promise.all([
      expect(firstStart).rejects.toThrow(
        'Run `pnpm build` once before using Worker/Web UI in dev.',
      ),
      expect(concurrentStart).rejects.toThrow(
        'Run `pnpm build` once before using Worker/Web UI in dev.',
      ),
    ])
    expect(concurrentStart).toBe(firstStart)

    await createWorkerBuildEntry()
    isReusableLocalWorkerConnectionMock.mockReset()
    isReusableLocalWorkerConnectionMock.mockResolvedValue(true)
    const retryChild = createWorkerChild()
    spawnMock.mockImplementation(() => {
      emitWorkerReady(retryChild)
      return retryChild
    })

    await expect(startLocalWorker()).resolves.toEqual(
      expect.objectContaining({ status: 'running' }),
    )
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a missing worker build entry in dev', async () => {
    await createTempUserDataDir()

    await expect(startLocalWorker()).rejects.toThrow(
      'Run `pnpm build` once before using Worker/Web UI in dev.',
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
