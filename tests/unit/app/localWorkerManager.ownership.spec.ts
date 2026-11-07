import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../src/shared/constants/controlSurface'

const mocks = vi.hoisted(() => ({
  directory: '',
  spawn: vi.fn(),
  remove: vi.fn(),
  healthy: vi.fn(),
  inspect: vi.fn(),
  legacy: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.directory, getAppPath: () => mocks.directory },
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, default: { spawn: mocks.spawn } }))
vi.mock('../../../src/platform/process/workerOwnerLock', () => ({
  acquireWorkerOwnerLock: () => ({ status: 'acquired', release: () => {} }),
}))
vi.mock('../../../src/platform/process/workerProcessIdentity', () => ({
  inspectWorkerProcess: mocks.inspect,
  legacyWorkerBlocksAcquisition: mocks.legacy,
}))
vi.mock('../../../src/app/main/worker/localWorkerCompatibility', () => ({
  isReusableLocalWorkerConnection: mocks.healthy,
  resolveLocalWorkerReusePolicy: () => ({ canReuse: false }),
}))
vi.mock('../../../src/app/main/controlSurface/http/connectionFile', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../src/app/main/controlSurface/http/connectionFile')
    >()
  return {
    ...actual,
    removeConnectionFile: async (dir: string, name: string) => {
      mocks.remove(dir, name)
      await actual.removeConnectionFile(dir, name)
    },
  }
})
import {
  repairStaleLocalWorkerFiles,
  startLocalWorker,
  stopLocalWorker,
} from '../../../src/app/main/worker/localWorkerManager'

const spawnMock = mocks.spawn
const removeConnectionFileMock = mocks.remove
const isReusableLocalWorkerConnectionMock = mocks.healthy
async function createTempUserDataDir(): Promise<string> {
  await mkdir(resolve('.codex-out/tmp'), { recursive: true })
  mocks.directory = await mkdtemp(resolve('.codex-out/tmp/b1-manager-'))
  return mocks.directory
}
function createConnectionInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    pid: process.pid,
    hostname: '127.0.0.1',
    port: 4321,
    token: 'test',
    createdAt: 'test',
    appVersion: 'test-version',
    startedBy: 'cli',
    ...overrides,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.healthy.mockResolvedValue(false)
  mocks.inspect.mockImplementation(async pid => (pid === 999_999 ? 'dead' : 'worker'))
  mocks.legacy.mockResolvedValue(false)
})
afterEach(async () => {
  if (mocks.directory) {
    await rm(mocks.directory, { recursive: true, force: true })
  }
  mocks.directory = ''
})
describe('Desktop ownership and repair', () => {
  it.each(['cli', 'desktop'])(
    'refuses a live unreachable %s owner without deleting or spawning',
    async startedBy => {
      const dir = await createTempUserDataDir()
      const path = resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE)
      const content = JSON.stringify(createConnectionInfo({ startedBy }))
      await writeFile(path, content)
      isReusableLocalWorkerConnectionMock.mockResolvedValueOnce(false)
      await expect(startLocalWorker()).rejects.toMatchObject({
        code: 'worker.external_owner_unreachable',
      })
      expect(spawnMock).not.toHaveBeenCalled()
      expect(removeConnectionFileMock).not.toHaveBeenCalled()
      expect(await readFile(path, 'utf8')).toBe(content)
    },
  )

  it('rejects stopping an external Worker with a stable error and no signal', async () => {
    const dir = await createTempUserDataDir()
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      JSON.stringify(createConnectionInfo()),
    )
    const signal = vi.spyOn(process, 'kill')
    try {
      await expect(stopLocalWorker()).rejects.toMatchObject({ code: 'worker.stop_not_owned' })
      expect(signal.mock.calls.every(([, value]) => value === 0)).toBe(true)
    } finally {
      signal.mockRestore()
    }
  })

  it('returns stopped when no Worker exists', async () => {
    await createTempUserDataDir()
    await expect(stopLocalWorker()).resolves.toEqual({ status: 'stopped', connection: null })
  })

  it('refuses a live PID-only legacy owner before spawn even without a connection', async () => {
    mocks.legacy.mockResolvedValue(true)
    const dir = await createTempUserDataDir()
    const path = resolve(dir, 'opencove-worker.lock')
    const content = JSON.stringify({ pid: process.pid })
    await writeFile(path, content)
    await expect(startLocalWorker()).rejects.toMatchObject({
      code: 'worker.external_owner_unreachable',
    })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(removeConnectionFileMock).not.toHaveBeenCalled()
    expect(await readFile(path, 'utf8')).toBe(content)
  })

  it('removes only a dead connection during repair', async () => {
    const dir = await createTempUserDataDir()
    const staleInfo = createConnectionInfo({ pid: 999_999, port: 4321 })
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(staleInfo)}\n`,
      'utf8',
    )
    await writeFile(
      resolve(dir, 'opencove-worker.lock'),
      `${JSON.stringify({ pid: 999_999, createdAt: new Date(0).toISOString() })}\n`,
      'utf8',
    )

    await repairStaleLocalWorkerFiles(dir, 999_999)

    expect(await readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')).toContain('999999')
    await expect(
      readFile(resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE), 'utf8'),
    ).rejects.toBeDefined()
  })

  it.each([undefined, 'old-instance'])(
    'permits recovery from unrelated reused PID metadata (%s)',
    async instanceId => {
      const dir = await createTempUserDataDir()
      await writeFile(
        resolve(dir, 'opencove-worker.lock'),
        JSON.stringify({ pid: process.pid, instanceId }),
      )
      const connectionPath = resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE)
      const connection = JSON.stringify(createConnectionInfo())
      await writeFile(connectionPath, connection)
      mocks.inspect.mockResolvedValue('unrelated')
      expect(await repairStaleLocalWorkerFiles(dir, process.pid)).toEqual({ status: 'safe' })
      expect(removeConnectionFileMock).not.toHaveBeenCalled()
      expect(await readFile(connectionPath, 'utf8')).toBe(connection)
      await expect(startLocalWorker()).rejects.toThrow('Local worker entry is missing')
    },
  )
  it('refuses repair when legacy inspection is inconclusive', async () => {
    const dir = await createTempUserDataDir()
    mocks.inspect.mockResolvedValue('unknown')
    expect(await repairStaleLocalWorkerFiles(dir, process.pid)).toEqual({
      status: 'external_owner',
    })
    expect(removeConnectionFileMock).not.toHaveBeenCalled()
  })
})
