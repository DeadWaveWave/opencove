import { createHook } from 'node:async_hooks'
// @vitest-environment node
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionTurnStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher'

afterEach(() => {
  vi.restoreAllMocks()
})
it('an asynchronous fs.watch error closes the failed watcher while the poll remains owned', async () => {
  const watcherEvents = Object.assign(new EventEmitter(), { close: vi.fn() })
  vi.spyOn(fs, 'watch').mockReturnValue(watcherEvents as unknown as fs.FSWatcher)
  const onError = vi.fn()
  const owner = new SessionTurnStateWatcher({
    provider: 'claude-code',
    sessionId: 's',
    filePath: '/missing',
    pollIntervalMs: 250,
    onState() {},
    onError,
  })
  owner.start()
  await vi.waitFor(() => expect(watcherEvents.listenerCount('error')).toBe(1))
  const error = Object.assign(new Error('watch'), { code: 'EPERM' })
  expect(() => watcherEvents.emit('error', error)).not.toThrow()
  expect(watcherEvents.close).toHaveBeenCalledOnce()
  expect(onError).toHaveBeenCalledWith(error)
  expect((owner as unknown as { watcher: unknown }).watcher).toBeNull()
  expect((owner as unknown as { poll: unknown }).poll).toBeDefined()
  owner.dispose()
})
it('continuous pending reads drain iteratively with one read in flight and stop after disposal', async () => {
  const owner = new SessionTurnStateWatcher({
    provider: 'claude-code',
    sessionId: 's',
    filePath: '/missing',
    onState() {},
  })
  const inner = owner as unknown as { readFileDelta(): Promise<void> }
  let reads = 0,
    inFlight = 0,
    maximum = 0
  vi.spyOn(inner, 'readFileDelta').mockImplementation(async () => {
    inFlight++
    maximum = Math.max(maximum, inFlight)
    reads++
    if (reads < 10_000) {
      owner.refresh()
    }
    await Promise.resolve()
    inFlight--
    if (reads === 10_000) {
      owner.dispose()
    }
  })
  const live = new Set<number>()
  let peak = 0
  const promises = createHook({
    init(id, type) {
      if (type === 'PROMISE') {
        live.add(id)
        peak = Math.max(peak, live.size)
      }
    },
    promiseResolve(id) {
      live.delete(id)
    },
  }).enable()
  try {
    owner.refresh()
    await vi.waitFor(() => expect(reads).toBe(10_000))
  } finally {
    promises.disable()
    owner.dispose()
  }
  expect(maximum).toBe(1)
  expect(peak).toBeLessThan(128)
  owner.refresh()
  expect(reads).toBe(10_000)
})
it('pending notifications received while a read is waiting are not lost', async () => {
  vi.spyOn(fsPromises, 'open').mockRejectedValue(
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
  )
  const owner = new SessionTurnStateWatcher({
    provider: 'codex',
    sessionId: 's',
    filePath: '/missing',
    onState() {},
  })
  const inner = owner as unknown as { readFileDelta(): Promise<void> }
  let finish!: () => void
  const read = vi.spyOn(inner, 'readFileDelta').mockImplementationOnce(
    async () =>
      await new Promise<void>(resolve => {
        finish = resolve
      }),
  )
  owner.refresh()
  owner.refresh()
  owner.refresh()
  expect(read).toHaveBeenCalledTimes(1)
  finish()
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  owner.dispose()
})
