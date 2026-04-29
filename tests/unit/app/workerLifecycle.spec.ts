import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../src/app/cli/constants.mjs'
import {
  getWorkerLifecycleStatus,
  stopWorkerLifecycle,
  WorkerLifecycleError,
} from '../../../src/app/cli/workerLifecycle.mjs'

const tempDirs = []

describe('CLI worker lifecycle', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  async function createTempUserDataDir() {
    const dir = await mkdtemp(join(tmpdir(), 'opencove-test-worker-lifecycle-'))
    tempDirs.push(dir)
    return dir
  }

  async function writeWorkerConnection(userDataPath, overrides = {}) {
    const info = {
      version: 1,
      pid: 12345,
      hostname: '127.0.0.1',
      port: 4567,
      token: 'token123',
      createdAt: new Date().toISOString(),
      startedBy: 'cli',
      ...overrides,
    }

    await writeFile(
      resolve(userDataPath, 'worker-control-surface.json'),
      `${JSON.stringify(info)}\n`,
      'utf8',
    )

    return info
  }

  function installReachableWorkerFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) => {
        const request = JSON.parse(String(init?.body ?? '{}'))
        const ok = value => JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value })

        if (request.id === 'system.ping') {
          return new Response(ok({ ok: true, now: new Date().toISOString(), pid: 12345 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }

        if (request.id === 'system.capabilities') {
          return new Response(
            ok({
              ok: true,
              now: new Date().toISOString(),
              pid: 12345,
              protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
              appVersion: null,
              features: {
                webShell: true,
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

        return new Response(ok({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
  }

  it('reports CLI-started local workers with lifecycle metadata', async () => {
    const userDataPath = await createTempUserDataDir()
    await writeWorkerConnection(userDataPath, { pid: 2222, startedBy: 'cli' })
    installReachableWorkerFetch()

    const status = await getWorkerLifecycleStatus({
      userData: userDataPath,
      isProcessAlive: pid => pid === 2222,
      all: true,
    })

    expect(status.status).toBe('running')
    expect(status.workers).toEqual([
      expect.objectContaining({
        status: 'running',
        pid: 2222,
        userDataPath,
        startedBy: 'cli',
        reachable: true,
      }),
    ])
  })

  it('stops CLI-started local workers by pid', async () => {
    const userDataPath = await createTempUserDataDir()
    await writeWorkerConnection(userDataPath, { pid: 3333, startedBy: 'cli' })
    installReachableWorkerFetch()

    let alive = true
    const sendSignal = vi.fn((_pid, _signal) => {
      alive = false
    })

    await expect(
      stopWorkerLifecycle({
        userData: userDataPath,
        pid: '3333',
        isProcessAlive: pid => pid === 3333 && alive,
        sendSignal,
        stopTimeoutMs: 20,
      }),
    ).resolves.toEqual({
      status: 'stopped',
      stopped: true,
      pid: 3333,
      userDataPath,
      startedBy: 'cli',
      forced: false,
    })
    expect(sendSignal).toHaveBeenCalledWith(3333, 'SIGTERM')
  })

  it('refuses to stop Desktop-started local workers without force', async () => {
    const userDataPath = await createTempUserDataDir()
    await writeWorkerConnection(userDataPath, { pid: 4444, startedBy: 'desktop' })
    installReachableWorkerFetch()
    const sendSignal = vi.fn()

    await expect(
      stopWorkerLifecycle({
        userData: userDataPath,
        isProcessAlive: pid => pid === 4444,
        sendSignal,
      }),
    ).rejects.toMatchObject({
      code: 'not_cli_owned',
      name: 'WorkerLifecycleError',
    })
    expect(sendSignal).not.toHaveBeenCalled()
  })

  it('force-stops Desktop-started local workers without requiring reachability', async () => {
    const userDataPath = await createTempUserDataDir()
    await writeWorkerConnection(userDataPath, { pid: 4545, startedBy: 'desktop' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch should not be called for forced stop')
      }),
    )

    let alive = true
    const sendSignal = vi.fn((_pid, _signal) => {
      alive = false
    })

    await expect(
      stopWorkerLifecycle({
        userData: userDataPath,
        force: true,
        isProcessAlive: pid => pid === 4545 && alive,
        sendSignal,
        stopTimeoutMs: 20,
      }),
    ).resolves.toMatchObject({
      status: 'stopped',
      stopped: true,
      pid: 4545,
      startedBy: 'desktop',
      forced: true,
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(sendSignal).toHaveBeenCalledWith(4545, 'SIGTERM')
  })

  it('refuses to stop unreachable CLI-started local workers without force', async () => {
    const userDataPath = await createTempUserDataDir()
    await writeWorkerConnection(userDataPath, { pid: 4646, startedBy: 'cli' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('worker is not reachable')
      }),
    )
    const sendSignal = vi.fn()

    await expect(
      stopWorkerLifecycle({
        userData: userDataPath,
        isProcessAlive: pid => pid === 4646,
        sendSignal,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({
      code: 'unreachable_worker',
      name: 'WorkerLifecycleError',
    })
    expect(sendSignal).not.toHaveBeenCalled()
  })

  it('requires an explicit target when multiple local workers are discoverable', async () => {
    const firstUserDataPath = await createTempUserDataDir()
    const secondUserDataPath = await createTempUserDataDir()
    await writeWorkerConnection(firstUserDataPath, { pid: 5555, startedBy: 'cli' })
    await writeWorkerConnection(secondUserDataPath, { pid: 6666, startedBy: 'cli' })

    await expect(
      stopWorkerLifecycle({
        userDataCandidates: [firstUserDataPath, secondUserDataPath],
        isProcessAlive: pid => pid === 5555 || pid === 6666,
      }),
    ).rejects.toBeInstanceOf(WorkerLifecycleError)
  })
})
