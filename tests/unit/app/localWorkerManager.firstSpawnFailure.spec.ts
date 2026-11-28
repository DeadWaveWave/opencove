import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({ directory: '', spawn: vi.fn(), healthy: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.directory, getAppPath: () => mocks.directory, isPackaged: false },
}))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: mocks.spawn, default: { ...actual, spawn: mocks.spawn } }
})
vi.mock('../../../src/app/main/worker/localWorkerCompatibility', () => ({
  isReusableLocalWorkerConnection: mocks.healthy,
  resolveLocalWorkerReusePolicy: () => ({ canReuse: true }),
}))
vi.mock('../../../src/app/main/controlSurface/runtimeAppVersion', () => ({
  readRuntimeAppVersion: () => 'test-version',
}))
vi.mock('../../../src/platform/process/workerOwnerLock', () => ({
  acquireWorkerOwnerLock: () => ({ status: 'acquired', release: () => {} }),
}))

import {
  startLocalWorker,
  stopOwnedLocalWorker,
} from '../../../src/app/main/worker/localWorkerManager'

type MockChild = EventEmitter & {
  pid: number
  stdout: PassThrough
  stderr: PassThrough
  killed: boolean
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill: ReturnType<typeof vi.fn>
}

function createMockChild(): MockChild {
  const child = Object.assign(new EventEmitter(), {
    pid: process.pid,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(() => {
      child.exitCode = 0
      child.emit('exit', 0)
      return true
    }),
  }) as MockChild
  return child
}

function readyConnection(child: MockChild) {
  return {
    version: 1,
    pid: child.pid,
    hostname: '127.0.0.1',
    port: 4321,
    token: 'fixture-token',
    createdAt: new Date().toISOString(),
    appVersion: 'test-version',
    startedBy: 'desktop',
  }
}

describe('local worker manager first spawn failure logging (#722)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    mocks.directory = await mkdtemp(join(tmpdir(), 'opencove-first-spawn-failure-'))
    await mkdir(join(mocks.directory, 'out', 'main'), { recursive: true })
    await writeFile(join(mocks.directory, 'out', 'main', 'worker.js'), '')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    mocks.healthy.mockResolvedValue(true)
  })

  afterEach(async () => {
    await stopOwnedLocalWorker()
    warnSpy.mockRestore()
    infoSpy.mockRestore()
    vi.clearAllMocks()
    if (mocks.directory) {
      await rm(mocks.directory, { recursive: true, force: true })
    }
    mocks.directory = ''
  })

  it('logs the first spawn failure with its reason and elapsed time, then retries', async () => {
    const failingChild = createMockChild()
    const readyChild = createMockChild()
    const connection = readyConnection(readyChild)
    mocks.spawn
      .mockImplementationOnce(() => {
        setTimeout(() => {
          failingChild.exitCode = 1
          failingChild.emit('exit', 1)
        }, 0)
        return failingChild
      })
      .mockImplementationOnce(() => {
        setTimeout(() => readyChild.stdout.write(`${JSON.stringify(connection)}\n`), 0)
        return readyChild
      })

    await expect(startLocalWorker()).resolves.toMatchObject({ status: 'running', connection })

    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = String(warnSpy.mock.calls[0]?.[0])
    expect(message).toMatch(/Local worker first spawn failed after \d+ms/)
    expect(message).toContain('Worker exited before ready (code=1)')
    expect(message).toContain('retrying once')
    expect(infoSpy).not.toHaveBeenCalled()
  }, 10_000)

  it('still logs the first failure when the retry fails, and surfaces the retry error', async () => {
    const firstChild = createMockChild()
    const retryChild = createMockChild()
    mocks.spawn
      .mockImplementationOnce(() => {
        setTimeout(() => {
          firstChild.exitCode = 1
          firstChild.emit('exit', 1)
        }, 0)
        return firstChild
      })
      .mockImplementationOnce(() => {
        setTimeout(() => {
          retryChild.exitCode = 2
          retryChild.emit('exit', 2)
        }, 0)
        return retryChild
      })

    await expect(startLocalWorker()).rejects.toThrow('Worker exited before ready (code=2)')

    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('Worker exited before ready (code=1)')
  }, 10_000)

  it('logs how long a successful first start takes', async () => {
    const child = createMockChild()
    const connection = readyConnection(child)
    mocks.spawn.mockImplementation(() => {
      setTimeout(() => child.stdout.write(`${JSON.stringify(connection)}\n`), 0)
      return child
    })

    await expect(startLocalWorker()).resolves.toMatchObject({ status: 'running', connection })

    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(String(infoSpy.mock.calls[0]?.[0])).toMatch(/Local worker started in \d+ms/)
  })
})
