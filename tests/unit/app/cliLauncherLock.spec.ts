// @vitest-environment node
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { withCliLauncherLock } from '../../../src/app/main/cli/cliLauncherLock'

let root: string
let target: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'opencove-lock-lease-'))
  target = join(root, 'opencove')
})
afterEach(async () => {
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
