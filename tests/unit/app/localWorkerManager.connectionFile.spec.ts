import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../src/shared/constants/controlSurface'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../src/shared/contracts/controlSurface'

let userDataDir: string | null = null
let appPath: string | null = null
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
const { readRuntimeAppVersionMock } = vi.hoisted(() => ({
  readRuntimeAppVersionMock: vi.fn(() => 'test-version'),
}))

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: spawnMock,
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
      ...overrides,
    }
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

    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const requestId = (() => {
        const body = init?.body
        if (typeof body !== 'string') {
          return ''
        }

        try {
          const parsed = JSON.parse(body) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return ''
          }

          const id = (parsed as Record<string, unknown>).id
          return typeof id === 'string' ? id : ''
        } catch {
          return ''
        }
      })()

      const ok = (value: unknown) =>
        JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value })

      if (requestId === 'system.ping') {
        return new Response(ok({ ok: true, now: new Date().toISOString(), pid: process.pid }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (requestId === 'system.capabilities') {
        return new Response(
          ok({
            ok: true,
            now: new Date().toISOString(),
            pid: process.pid,
            protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
            appVersion: 'test-version',
            features: {
              webShell: false,
              sync: { state: true, events: true },
              sessionStreaming: {
                enabled: true,
                ptyProtocolVersion: 1,
                replayWindowMaxBytes: 400_000,
                roles: { viewer: true, controller: true },
                webAuth: { ticketToCookie: true, cookieSession: true },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      if (requestId === 'endpoint.list') {
        return new Response(ok({ endpoints: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response(ok({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

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

    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const requestId =
        body.length > 0 ? ((JSON.parse(body) as Record<string, unknown>).id as string) : ''
      const ok = (value: unknown) =>
        JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value })

      if (requestId === 'system.ping') {
        return new Response(ok({ ok: true, now: new Date().toISOString(), pid: process.pid }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (requestId === 'system.capabilities') {
        return new Response(
          ok({
            ok: true,
            now: new Date().toISOString(),
            pid: process.pid,
            protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
            appVersion: 'old-version',
            features: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      throw new Error(`Unexpected request: ${requestId}`)
    })
    vi.stubGlobal('fetch', fetchMock)

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

  it('treats workers missing endpoint list as stopped', async () => {
    const dir = await createTempUserDataDir()
    const info = createConnectionInfo()
    await writeFile(
      resolve(dir, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
      `${JSON.stringify(info)}\n`,
      'utf8',
    )

    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const requestId =
        body.length > 0 ? ((JSON.parse(body) as Record<string, unknown>).id as string) : ''

      const ok = (value: unknown) =>
        JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value })
      const fail = (error: unknown) =>
        JSON.stringify({ __opencoveControlEnvelope: true, ok: false, error })

      if (requestId === 'system.ping') {
        return new Response(ok({ ok: true, now: new Date().toISOString(), pid: process.pid }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (requestId === 'system.capabilities') {
        return new Response(
          ok({
            ok: true,
            now: new Date().toISOString(),
            pid: process.pid,
            protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
            appVersion: 'test-version',
            features: {
              webShell: false,
              sync: { state: true, events: true },
              sessionStreaming: {
                enabled: true,
                ptyProtocolVersion: 1,
                replayWindowMaxBytes: 400_000,
                roles: { viewer: true, controller: true },
                webAuth: { ticketToCookie: true, cookieSession: true },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      if (requestId === 'endpoint.list') {
        return new Response(
          fail({
            code: 'common.invalid_input',
            debugMessage: 'Unknown control surface query: endpoint.list',
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }

      return new Response(ok({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

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

  it('surfaces a missing worker build entry in dev', async () => {
    await createTempUserDataDir()

    await expect(startLocalWorker()).rejects.toThrow(
      'Run `pnpm build` once before using Worker/Web UI in dev.',
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
