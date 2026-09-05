import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../src/shared/constants/controlSurface'

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
import {
  startLocalWorker,
  stopOwnedLocalWorker,
} from '../../../src/app/main/worker/localWorkerManager'

afterEach(async () => {
  await stopOwnedLocalWorker()
  if (mocks.directory) {
    await rm(mocks.directory, { recursive: true, force: true })
  }
  mocks.directory = ''
})

it('does not replace its live compatible child when a health probe reports it busy', async () => {
  mocks.directory = await mkdtemp(join(tmpdir(), 'opencove-owned-worker-'))
  await mkdir(join(mocks.directory, 'out', 'main'), { recursive: true })
  await writeFile(join(mocks.directory, 'out', 'main', 'worker.js'), '')
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
  })
  const connection = {
    version: 1,
    pid: child.pid,
    hostname: '127.0.0.1',
    port: 4321,
    token: 'fixture-token',
    createdAt: new Date().toISOString(),
    appVersion: 'test-version',
    startedBy: 'desktop',
  }
  mocks.spawn.mockImplementation(() => {
    setTimeout(() => child.stdout.write(JSON.stringify(connection) + '\n'), 0)
    return child
  })
  mocks.healthy.mockResolvedValue(true)
  await expect(startLocalWorker()).resolves.toMatchObject({ status: 'running' })
  await writeFile(
    join(mocks.directory, WORKER_CONTROL_SURFACE_CONNECTION_FILE),
    JSON.stringify(connection),
  )
  mocks.healthy.mockResolvedValue(false)
  await expect(startLocalWorker()).resolves.toMatchObject({ status: 'running', connection })
  expect(mocks.spawn).toHaveBeenCalledTimes(1)
  expect(child.kill).not.toHaveBeenCalled()
})
