import fs from 'node:fs/promises'
// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as transcriptAccess from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'
import { ClaudeResumeTranscriptReader } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeResumeTranscriptReader'
const actualAccess = transcriptAccess.claudeTranscriptAccess
const real = readFileSync(
  join(__dirname, '../../fixtures/claude/clear-successor-2.1.321.jsonl'),
  'utf8',
)
let root: string, path: string
const cleanup: (() => Promise<void>)[] = []
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claude-reader-deadline-'))
  await mkdir(join(root, 'projects', 'workspace'), { recursive: true })
  path = join(root, 'projects', 'workspace', 'B.jsonl')
  await writeFile(path, real)
})
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map(close => close()))
  await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const capability = transcriptAccess.claudeTranscriptAccess(path, 'B', [root])
  const file = await capability.validate(),
    handle = await capability.open(),
    close = handle.close.bind(handle)
  cleanup.push(async () => {
    await close().catch(() => {})
  })
  const access = { open: vi.fn(async () => handle), validate: vi.fn(async () => file) }
  vi.spyOn(transcriptAccess, 'claudeTranscriptAccess').mockReturnValue(access)
  const controller = new AbortController()
  vi.useFakeTimers()
  const read = () =>
    new ClaudeResumeTranscriptReader([root], { deadlineMs: 20, retryMs: 1 }).confirmCompletedTurn(
      {
        occurrenceId: 'occ',
        ordinal: 1,
        resumeSessionId: 'B',
        promptId: 'p',
        transcriptPath: path,
      },
      controller.signal,
    )
  return { access, controller, handle, close, file, read }
}
it.each(['validate', 'close'] as const)(
  'bounds delayed %s and never returns a late proof from the real fixture',
  async operation => {
    const f = await fixture(),
      entered = deferred<void>(),
      release = deferred<void>()
    const closeSpy = vi.spyOn(f.handle, 'close')
    if (operation === 'validate') {
      f.access.validate.mockImplementation(async () => {
        entered.resolve()
        await release.promise
        return f.file
      })
    } else {
      closeSpy.mockImplementation(async () => {
        entered.resolve()
        await release.promise
        await f.close()
      })
    }
    let settled = false
    const result = f.read().then(proof => {
      settled = true
      return proof
    })
    try {
      await entered.promise
      await vi.advanceTimersByTimeAsync(21)
      expect(settled).toBe(true)
      expect(await result).toBeNull()
    } finally {
      release.resolve()
      await result
      f.controller.abort()
    }
    expect(closeSpy).toHaveBeenCalledOnce()
  },
)
it('discards proof when final validation finishes after the absolute budget', async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    release = deferred<void>()
  f.access.validate.mockImplementation(async () => {
    entered.resolve()
    await release.promise
    return f.file
  })
  const result = f.read()
  await entered.promise
  await vi.advanceTimersByTimeAsync(83)
  release.resolve()
  expect(await result).toBeNull()
})
it.each(['open', 'stat', 'read', 'validate', 'close'] as const)(
  'returns at its deadline when %s never settles',
  async operation => {
    const f = await fixture(),
      entered = deferred<void>()
    const never = () => {
      entered.resolve()
      return new Promise<never>(() => {})
    }
    if (operation === 'open') {
      f.access.open.mockImplementation(never)
    } else if (operation === 'validate') {
      f.access.validate.mockImplementation(never)
    } else {
      vi.spyOn(f.handle, operation).mockImplementation(never)
    }
    let settled = false
    const result = f.read().then(proof => {
      settled = true
      return proof
    })
    await entered.promise
    await vi.advanceTimersByTimeAsync(21)
    try {
      expect(settled).toBe(true)
      expect(await result).toBeNull()
    } finally {
      f.controller.abort()
    }
  },
)
it.each(['timeout', 'caller abort'] as const)(
  'closes a late open handle after %s without scanning it',
  async kind => {
    const f = await fixture(),
      opening = deferred<FileHandle>()
    f.access.open.mockReturnValue(opening.promise)
    const closeSpy = vi.spyOn(f.handle, 'close'),
      readSpy = vi.spyOn(f.handle, 'read')
    let settled = false
    const result = f.read().then(proof => {
      settled = true
      return proof
    })
    if (kind === 'timeout') {
      await vi.advanceTimersByTimeAsync(21)
    } else {
      f.controller.abort()
      await vi.advanceTimersByTimeAsync(0)
    }
    try {
      expect(settled).toBe(true)
      expect(await result).toBeNull()
    } finally {
      opening.resolve(f.handle)
      f.controller.abort()
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(closeSpy).toHaveBeenCalledOnce()
    expect(readSpy).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  },
)

it('cleans an opened descriptor when validation inside the real access port stalls', async () => {
  const f = await fixture(),
    entered = deferred<void>()
  vi.mocked(transcriptAccess.claudeTranscriptAccess).mockImplementation(actualAccess)
  vi.spyOn(fs, 'open').mockResolvedValue(f.handle)
  vi.spyOn(f.handle, 'stat').mockImplementation(() => {
    entered.resolve()
    return new Promise(() => {})
  })
  const closeSpy = vi.spyOn(f.handle, 'close')
  const result = f.read()
  await entered.promise
  await vi.advanceTimersByTimeAsync(21)
  expect(await result).toBeNull()
  expect(closeSpy).toHaveBeenCalledOnce()
})
