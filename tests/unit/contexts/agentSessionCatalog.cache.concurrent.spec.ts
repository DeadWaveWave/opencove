import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearSessionFileCache,
  readSessionFileWithCache,
} from '../../../src/contexts/agent/infrastructure/cli/AgentSessionCatalog.cache'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('session file scan ownership', () => {
  afterEach(clearSessionFileCache)

  it('shares one pending scan across concurrent requests for the same fingerprint', async () => {
    const scan = deferred<string | null>()
    const compute = vi.fn(() => scan.promise)
    const requests = Array.from({ length: 32 }, () =>
      readSessionFileWithCache('transcript.jsonl', { mtimeMs: 1, size: 100 }, compute),
    )
    await Promise.resolve()
    const scansStarted = compute.mock.calls.length
    scan.resolve(null)
    expect(await Promise.all(requests)).toEqual(Array(32).fill(null))
    expect(scansStarted).toBe(1)
    expect(
      await readSessionFileWithCache('transcript.jsonl', { mtimeMs: 1, size: 100 }, compute),
    ).toBeNull()
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('does not let an older scan replace the result of a newer fingerprint', async () => {
    const old = deferred<string>()
    const first = readSessionFileWithCache(
      'transcript.jsonl',
      { mtimeMs: 1, size: 100 },
      () => old.promise,
    )
    expect(
      await readSessionFileWithCache(
        'transcript.jsonl',
        { mtimeMs: 2, size: 200 },
        async () => 'new title',
      ),
    ).toBe('new title')
    old.resolve('old title')
    expect(await first).toBe('old title')
    const compute = vi.fn(async () => 'unexpected rescan')
    expect(
      await readSessionFileWithCache('transcript.jsonl', { mtimeMs: 2, size: 200 }, compute),
    ).toBe('new title')
    expect(compute).not.toHaveBeenCalled()
  })

  it('releases a failed scan so the same file can be retried', async () => {
    const scan = deferred<string>()
    const compute = vi.fn(() => scan.promise)
    const first = readSessionFileWithCache('transcript.jsonl', { mtimeMs: 1, size: 100 }, compute)
    const second = readSessionFileWithCache('transcript.jsonl', { mtimeMs: 1, size: 100 }, compute)
    const failed = Promise.allSettled([first, second])
    scan.reject(new Error('read failed'))
    expect((await failed).map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(compute).toHaveBeenCalledTimes(1)
    expect(
      await readSessionFileWithCache(
        'transcript.jsonl',
        { mtimeMs: 1, size: 100 },
        async () => 'retried title',
      ),
    ).toBe('retried title')
  })

  it('still joins an older pending fingerprint while a newer version is being scanned', async () => {
    const old = deferred<string>()
    const next = deferred<string>()
    const oldCompute = vi.fn(() => old.promise)
    const first = readSessionFileWithCache(
      'transcript.jsonl',
      { mtimeMs: 1, size: 100 },
      oldCompute,
    )
    const second = readSessionFileWithCache(
      'transcript.jsonl',
      { mtimeMs: 2, size: 200 },
      () => next.promise,
    )
    const repeated = readSessionFileWithCache(
      'transcript.jsonl',
      { mtimeMs: 1, size: 100 },
      oldCompute,
    )
    old.resolve('old')
    next.resolve('new')
    expect(await Promise.all([first, second, repeated])).toEqual(['old', 'new', 'old'])
    expect(oldCompute).toHaveBeenCalledTimes(1)
    expect(
      await readSessionFileWithCache(
        'transcript.jsonl',
        { mtimeMs: 2, size: 200 },
        async () => 'wrong',
      ),
    ).toBe('new')
  })

  it('fences an outstanding scan when the cache is cleared', async () => {
    const scan = deferred<string>()
    const first = readSessionFileWithCache(
      'transcript.jsonl',
      { mtimeMs: 1, size: 100 },
      () => scan.promise,
    )
    clearSessionFileCache()
    scan.resolve('discarded title')
    await first
    expect(
      await readSessionFileWithCache(
        'transcript.jsonl',
        { mtimeMs: 1, size: 100 },
        async () => 'fresh title',
      ),
    ).toBe('fresh title')
  })
})
