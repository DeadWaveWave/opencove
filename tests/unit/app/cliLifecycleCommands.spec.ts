import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  CONTROL_SURFACE_REQUEST_DRAIN_TIMEOUT_MS,
  CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS,
  LOCAL_WORKER_STOP_TIMEOUT_MS,
} from '../../../src/shared/runtime/controlSurfaceShutdown'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
const mocks = vi.hoisted(() => ({ status: vi.fn(), stop: vi.fn(), spawn: vi.fn() }))
vi.mock('../../../src/app/cli/workerLifecycle.mjs', () => ({
  getWorkerLifecycleStatus: mocks.status,
  stopWorkerLifecycle: mocks.stop,
  WorkerLifecycleError: class extends Error {},
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, default: { spawn: mocks.spawn } }))
vi.mock('node:fs', () => ({ existsSync: () => true, default: { existsSync: () => true } }))
vi.mock('../../../src/app/cli/runtime.mjs', () => ({
  resolveCliRuntime: () => ({
    kind: 'source',
    repoRoot: '/fixture',
    workerScriptPath: '/fixture/worker.js',
  }),
  resolveCliAppVersion: () => '1.0.0',
  resolveWorkerRuntimeForStart: async () => ({ kind: 'node', executablePath: '/fixture/node' }),
  createWorkerSpawnEnvironment: () => ({}),
}))
let child: EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  stdin: PassThrough
  send: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
}
const nativePlatform = process.platform
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: nativePlatform })
})
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  vi.clearAllMocks()
  child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    send: vi.fn(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit('close', null))
      return true
    }),
  })
  mocks.spawn.mockReturnValue(child)
  mocks.status.mockResolvedValue({ status: 'stopped', workers: [] })
  mocks.stop.mockResolvedValue({ status: 'stopped', stopped: false })
})
function fixture() {
  let out = '',
    err = ''
  const controller = new AbortController()
  const io: CliIo = {
    stdout: {
      write: s => {
        out += s
      },
    },
    stderr: {
      write: s => {
        err += s
      },
    },
    fetch: vi.fn(),
    env: {},
    now: Date.now,
    signal: controller.signal,
    readStdinText: vi.fn(async () => '{"request":true}'),
    readTextFile: vi.fn(async () => JSON.stringify({ schemaVersion: 1, buildId: 'a'.repeat(64) })),
  }
  return { io, controller, out: () => out, err: () => err }
}
it.each(['status', 'stop'])('executes worker %s through lifecycle owner', async name => {
  const f = fixture()
  expect(await run(['worker', name, '--user-data', '/isolated'], f.io)).toBe(0)
  expect(name === 'status' ? mocks.status : mocks.stop).toHaveBeenCalledWith(
    expect.objectContaining({ userData: '/isolated' }),
  )
  expect(f.io.fetch).not.toHaveBeenCalled()
  expect(f.out()).not.toContain('__opencoveControlEnvelope')
  expect(JSON.parse(f.out()).status).toBe('stopped')
})
it('inspects build identity without spawning', async () => {
  const f = fixture()
  expect(await run(['runtime', 'inspect'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).buildId).toBe('a'.repeat(64))
  expect(mocks.spawn).not.toHaveBeenCalled()
})
it.each(['verify', 'prepare'])('executes runtime %s with value-only output', async name => {
  const f = fixture()
  const result = run(['runtime', name], f.io)
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
  child.stdout.write(name === 'verify' ? ' {"verified":true}\n' : 'progress\n')
  child.emit('close', 0)
  expect(await result).toBe(0)
  expect(JSON.parse(f.out())).toEqual(
    name === 'verify' ? { verified: true } : { status: 'prepared' },
  )
  expect(f.io.fetch).not.toHaveBeenCalled()
})
it('keeps worker foreground, passes launch flags, and cleans up on interrupt', async () => {
  const f = fixture()
  let completed = false
  const result = run(
    [
      'worker',
      'start',
      '--user-data',
      '/isolated',
      '--approve-root',
      '/one',
      '--approve-root',
      '/two',
      '--token=--opaque',
    ],
    f.io,
  ).then(code => {
    completed = true
    return code
  })
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
  expect(completed).toBe(false)
  expect(mocks.spawn.mock.calls[0][1]).toEqual(
    expect.arrayContaining([
      '--user-data=/isolated',
      '--approve-root=/one',
      '--approve-root=/two',
      '--token=--opaque',
    ]),
  )
  child.stdout.write('worker diagnostic\n')
  f.controller.abort()
  expect(await result).toBe(130)
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  expect(f.out()).toBe('')
  expect(JSON.parse(f.err()).error.details.diagnostics).toContain('worker diagnostic')
})

it.each(['close', 'escalate'] as const)(
  'respects the worker shutdown owner budget and %s cleanup',
  async outcome => {
    const f = fixture()
    child.kill.mockImplementation(() => true)
    let completed = false
    const result = run(['worker', 'start', '--user-data', '/isolated'], f.io).then(code => {
      completed = true
      return code
    })
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    vi.useFakeTimers()
    try {
      f.controller.abort()
      expect(child.kill.mock.calls).toEqual([['SIGTERM']])
      await vi.advanceTimersByTimeAsync(5000)
      expect(child.kill.mock.calls).toEqual([['SIGTERM']])
      await vi.advanceTimersByTimeAsync(CONTROL_SURFACE_REQUEST_DRAIN_TIMEOUT_MS - 5000)
      expect(child.kill.mock.calls).toEqual([['SIGTERM']])
      await vi.advanceTimersByTimeAsync(
        CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS - CONTROL_SURFACE_REQUEST_DRAIN_TIMEOUT_MS,
      )
      expect(child.kill.mock.calls).toEqual([['SIGTERM']])
      expect(completed).toBe(false)
      if (outcome === 'close') {
        child.emit('close', 0)
        expect(await result).toBe(130)
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(LOCAL_WORKER_STOP_TIMEOUT_MS)
        expect(child.kill.mock.calls).toEqual([['SIGTERM']])
      } else {
        await vi.advanceTimersByTimeAsync(
          LOCAL_WORKER_STOP_TIMEOUT_MS - CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS - 1,
        )
        expect(child.kill.mock.calls).toEqual([['SIGTERM']])
        await vi.advanceTimersByTimeAsync(1)
        expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
        child.emit('close', null)
        expect(await result).toBe(130)
        expect(vi.getTimerCount()).toBe(0)
      }
      expect(f.out()).toBe('')
    } finally {
      child.emit('close', null)
      await result
      vi.useRealTimers()
    }
  },
)

it.each(['verify', 'prepare'])(
  'runtime %s failure emits one JSON document with bounded diagnostics',
  async name => {
    const f = fixture()
    const result = run(['runtime', name, '-o', 'json'], f.io)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    child.stderr.write('x'.repeat(20_000))
    child.stderr.write('validation failed 中文\n')
    if (name === 'prepare') {
      child.stdout.write('progress\n')
    }
    expect(f.err()).toBe('')
    child.emit('close', 1)
    expect(await result).toBe(1)
    const error = JSON.parse(f.err()).error
    expect(error.code).toBe('runtime.failed')
    expect(error.details.diagnostics).toContain('validation failed 中文')
    expect(error.details.diagnostics.length).toBeLessThanOrEqual(16_384)
    expect(error.details.diagnosticsTruncated).toBe(true)
    expect(f.out()).toBe('')
  },
)
it('streams progress only when explicitly requested', async () => {
  const f = fixture()
  const result = run(['runtime', 'prepare', '--stream-progress'], f.io)
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
  child.stdout.write('progress\n')
  expect(f.err()).toBe('progress\n')
  child.emit('close', 0)
  expect(await result).toBe(0)
})
it.each(['close', 'escalate'])('Windows requests IPC shutdown before %s', async outcome => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const f = fixture()
  child.kill.mockImplementation(() => true)
  const result = run(['worker', 'start', '--user-data', '/isolated'], f.io)
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
  expect(mocks.spawn.mock.calls[0][2].stdio).toContain('ipc')
  vi.useFakeTimers()
  try {
    f.controller.abort()
    expect(child.send).toHaveBeenCalledWith(
      { type: 'opencove.worker.shutdown' },
      expect.any(Function),
    )
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(LOCAL_WORKER_STOP_TIMEOUT_MS - 1)
    expect(child.kill).not.toHaveBeenCalled()
    if (outcome === 'escalate') {
      await vi.advanceTimersByTimeAsync(1)
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    }
    child.emit('close', 0)
    expect(await result).toBe(130)
    expect(vi.getTimerCount()).toBe(0)
    expect(child.kill).not.toHaveBeenCalledWith('SIGTERM')
  } finally {
    child.emit('close', 0)
    await result
    vi.useRealTimers()
  }
})
