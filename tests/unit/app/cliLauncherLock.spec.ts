// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { withCliLauncherLock } from '../../../src/app/main/cli/cliLauncherLock'

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, stat: vi.fn(fs.stat), unlink: vi.fn(fs.unlink) }
})

let root: string
let target: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'opencove-lock-lease-'))
  target = join(root, 'opencove')
})
afterEach(async () => {
  vi.mocked(unlink).mockReset()
  vi.mocked(stat).mockReset()
  await rm(root, { recursive: true, force: true })
})

async function expire() {
  const old = new Date(Date.now() - 121_000)
  await utimes(`${target}.lock`, old, old)
}

it('records owner identity and rejects a fresh lock with pid and age', async () => {
  await withCliLauncherLock(target, async () => {
    const owner = JSON.parse(await readFile(`${target}.lock`, 'utf8'))
    expect(owner).toMatchObject({ pid: process.pid, hostname: hostname() })
    expect(new Date(owner.createdAt).toISOString()).toBe(owner.createdAt)
    await expect(withCliLauncherLock(target, async () => {})).rejects.toThrow(
      `owner pid=${process.pid}, age=`,
    )
  })
})

it('recovers a crashed legacy lock based on mtime even without an owner record', async () => {
  await writeFile(`${target}.lock`, '')
  await expire()
  await withCliLauncherLock(target, async () => {
    expect(JSON.parse(await readFile(`${target}.lock`, 'utf8')).pid).toBe(process.pid)
  })
})

it('elects exactly one concurrent stale-lock contender while the winner publishes', async () => {
  await writeFile(`${target}.lock`, '{}')
  await expire()
  let winners = 0
  let finishedAttempts = 0
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const attempts = Array.from({ length: 8 }, () =>
    withCliLauncherLock(target, async () => {
      winners += 1
      finishedAttempts += 1
      if (finishedAttempts === 8) {
        release()
      }
      await held
    }).catch(error => {
      expect(error.code).toBe('EEXIST')
      finishedAttempts += 1
      if (finishedAttempts === 8) {
        release()
      }
    }),
  )
  await Promise.all(attempts)
  expect(winners).toBe(1)
})

it('elects one winner when a stale contender pauses between its final check and unlink', async () => {
  await writeFile(`${target}.lock`, '{}')
  await expire()
  const paused = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  const held = Promise.withResolvers<void>()
  const firstDecided = Promise.withResolvers<void>()
  const secondDecided = Promise.withResolvers<void>()
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(unlink).mockImplementationOnce(async path => {
    expect(path).toBe(`${target}.lock`)
    paused.resolve()
    await resume.promise
    await fs.unlink(path)
  })
  let winners = 0
  const attempt = (decided: typeof firstDecided) =>
    withCliLauncherLock(target, async () => {
      winners += 1
      decided.resolve()
      await held.promise
    }).catch(error => {
      decided.resolve()
      expect(error.code).toBe('EEXIST')
    })
  const first = attempt(firstDecided)
  let second: Promise<void> | undefined
  try {
    await paused.promise
    second = attempt(secondDecided)
    // The second contender either publishes or loses; no wall-clock sleeps.
    await secondDecided.promise
    resume.resolve()
    await firstDecided.promise
    expect(winners).toBe(1)
  } finally {
    resume.resolve()
    held.resolve()
    await Promise.all([first, second])
  }
})

it('an expired publisher does not release the replacement owner lock', async () => {
  let successor: string = ''
  await withCliLauncherLock(target, async () => {
    await expire()
    // Hold the successor beyond the original callback, then check the first release.
    successor = JSON.stringify({
      pid: 123,
      hostname: 'successor',
      createdAt: new Date().toISOString(),
    })
    await rm(`${target}.lock`)
    await writeFile(`${target}.lock`, successor, { flag: 'wx' })
  })
  expect(await readFile(`${target}.lock`, 'utf8')).toBe(successor)
})

it('rechecks the lock after a delayed contender acquires the reclamation claim', async () => {
  await writeFile(`${target}.lock`, '{}')
  await expire()
  const observed = await stat(`${target}.lock`)
  const paused = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  vi.mocked(stat).mockImplementationOnce(async () => {
    paused.resolve()
    await resume.promise
    return observed
  })
  const publish = vi.fn(async () => {})
  const delayed = expect(withCliLauncherLock(target, publish)).rejects.toMatchObject({
    code: 'EEXIST',
  })
  try {
    await paused.promise
    await withCliLauncherLock(target, async () => {
      const owner = await readFile(`${target}.lock`, 'utf8')
      resume.resolve()
      await delayed
      expect(await readFile(`${target}.lock`, 'utf8')).toBe(owner)
    })
    expect(publish).not.toHaveBeenCalled()
  } finally {
    resume.resolve()
    await delayed
  }
  expect(await readdir(root)).toEqual([])
})

it('recovers a crashed reclamation claim and cleans up after publication fails', async () => {
  await writeFile(`${target}.lock`, '')
  await expire()
  const claimPath = `${target}.lock.reclaim`
  await writeFile(claimPath, '')
  const old = new Date(Date.now() - 121_000)
  await utimes(claimPath, old, old)
  const failure = new Error('publication failed')
  await expect(
    withCliLauncherLock(target, async () => {
      throw failure
    }),
  ).rejects.toBe(failure)
  expect(await readdir(root)).toEqual([])
  await withCliLauncherLock(target, async () => {})
})
