import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acquireHomeWorkerConfigLease,
  HOME_WORKER_CONFIG_LEASE_FILE,
  HOME_WORKER_CONFIG_LEASE_OWNER_FILE,
  withHomeWorkerConfigLease,
} from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'
import {
  createFakeClock,
  createUserDataPath,
  exists,
  fsError,
  ownerPath,
  registerLeaseTempDirCleanup,
} from './homeWorkerConfigLease.helpers'

type Failure = Error & { cause?: { code?: string } }

async function failureOf(promise: Promise<unknown>): Promise<Failure | null> {
  return await promise.then(
    () => null,
    (error: unknown) => error as Failure,
  )
}

// A file where owner.json should be a file but is a directory, so the record cannot be read.
async function makeRecordUnreadable(lockPath: string): Promise<void> {
  const owner = resolve(lockPath, HOME_WORKER_CONFIG_LEASE_OWNER_FILE)
  await rm(owner, { recursive: true, force: true })
  await mkdir(owner)
}

async function makeRecordReadable(lockPath: string, record: string): Promise<void> {
  const owner = resolve(lockPath, HOME_WORKER_CONFIG_LEASE_OWNER_FILE)
  await rm(owner, { recursive: true, force: true })
  await writeFile(owner, record)
}

describe('Home Worker configuration lease release with an unreadable record', () => {
  registerLeaseTempDirCleanup()

  it('R1a retries a release whose lease record cannot be read until it can be', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'holder',
        platform: 'win32',
        now: clock.now,
        wait: async delayMs => {
          await clock.wait(delayMs)
          await makeRecordReadable(lockPath, record)
        },
      },
    })
    const record = await readFile(ownerPath(userDataPath), 'utf8')
    await makeRecordUnreadable(lockPath)

    await lease.release()

    expect(clock.waits.length).toBeGreaterThan(0)
    expect(await exists(lockPath)).toBe(false)
  }, 10_000)

  it('R1b rejects a release whose lease record stays unreadable, without renaming the lease', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    let leaseRenames = 0
    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'holder',
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (from === lockPath) {
            leaseRenames += 1
          }
          await rename(from, to)
        },
      },
    })
    await makeRecordUnreadable(lockPath)

    const failure = await failureOf(lease.release())

    expect(failure).toMatchObject({ name: 'HomeWorkerConfigLeaseReleaseError' })
    expect(leaseRenames).toBe(0)
    expect(await exists(lockPath)).toBe(true)
  }, 10_000)

  it('R2a retries a release whose captured record cannot be read and then succeeds', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    let record = ''
    let damaged = false
    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'holder',
        platform: 'win32',
        now: clock.now,
        wait: async delayMs => {
          await clock.wait(delayMs)
          // The restored lease keeps the unreadable record until something makes it readable.
          await makeRecordReadable(lockPath, record)
        },
        rename: async (from, to) => {
          await rename(from, to)
          if (from === lockPath && !damaged) {
            damaged = true
            await makeRecordUnreadable(to)
          }
        },
      },
    })
    record = await readFile(ownerPath(userDataPath), 'utf8')

    await lease.release()

    expect(damaged).toBe(true)
    expect(record).toContain('holder')
    // The first pass captured an unreadable record and put it back; the retry released it.
    expect(await exists(lockPath)).toBe(false)
  }, 10_000)

  it('R2b rejects a release whose captured record never becomes readable and restores the lease', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'holder',
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          await rename(from, to)
          if (from === lockPath) {
            await makeRecordUnreadable(to)
          }
        },
      },
    })

    const failure = await failureOf(lease.release())

    expect(failure).toMatchObject({ name: 'HomeWorkerConfigLeaseReleaseError' })
    // It never resolves while its own lease is still on disk.
    expect(await exists(lockPath)).toBe(true)
  }, 10_000)
})

describe('Home Worker configuration lease release deadline', () => {
  registerLeaseTempDirCleanup()

  it('9b settles a stuck release by the release deadline passed to it', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    const startedAt = clock.now()
    const reported: unknown[] = []

    await withHomeWorkerConfigLease(userDataPath, async () => 'ready', {
      releaseTimeoutMs: 500,
      onReleaseError: error => reported.push(error),
      dependencies: {
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (from === lockPath) {
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    })

    expect(reported).toHaveLength(1)
    // The deadline plus at most one backoff step.
    expect(clock.now() - startedAt).toBeLessThanOrEqual(500 + 100)
    expect(clock.now() - startedAt).toBeGreaterThanOrEqual(500)
  }, 10_000)

  it('9c keeps the default release deadline at 5 s for other callers', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (from === lockPath) {
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    })
    const startedAt = clock.now()

    await failureOf(lease.release())

    expect(clock.now() - startedAt).toBeGreaterThanOrEqual(5_000)
    expect(clock.now() - startedAt).toBeLessThanOrEqual(5_000 + 100)
  }, 10_000)
})

describe('Home Worker configuration lease stale release', () => {
  registerLeaseTempDirCleanup()

  it('14 does not rename a lease that holds a readable record with another token', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    let leaseRenames = 0
    const first = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'first-owner',
        rename: async (from, to) => {
          if (from === lockPath) {
            leaseRenames += 1
          }
          await rename(from, to)
        },
      },
    })
    await rm(lockPath, { recursive: true })
    const second = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: { token: () => 'second-owner' },
    })

    await first.release()

    // Renaming the replacement away, even to put it back, leaves the path empty for a moment.
    expect(leaseRenames).toBe(0)
    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('second-owner')
    await second.release()
  }, 10_000)
})

describe('Home Worker configuration lease restore bounds', () => {
  registerLeaseTempDirCleanup()

  async function writeDeadOwnerLease(userDataPath: string): Promise<string> {
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    await mkdir(lockPath)
    await writeFile(
      ownerPath(userDataPath),
      `${JSON.stringify({ pid: 999_999, token: 'dead', createdAt: '2026-01-01T00:00:00.000Z' })}\n`,
    )
    return lockPath
  }

  // The reclaim captures the lease, then another process changes what was captured, so the
  // identity differs and the reclaim must put the capture back.
  function reclaimThatCapturesAChangedLease(
    lockPath: string,
    restoreFailures: number,
  ): (from: string, to: string) => Promise<void> {
    let restoreAttempts = 0
    return async (from, to) => {
      if (from === lockPath) {
        await rename(from, to)
        await writeFile(
          resolve(to, HOME_WORKER_CONFIG_LEASE_OWNER_FILE),
          `${JSON.stringify({ pid: 999_998, token: 'other', createdAt: '2026-01-02T00:00:00.000Z' })}\n`,
        )
        return
      }
      if (to === lockPath && from.includes('.stale-')) {
        restoreAttempts += 1
        if (restoreAttempts <= restoreFailures) {
          throw fsError('EPERM')
        }
      }
      await rename(from, to)
    }
  }

  it('15 settles a reclaim whose restore keeps failing by the acquisition deadline', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = await writeDeadOwnerLease(userDataPath)
    const clock = createFakeClock()
    const startedAt = clock.now()
    const timeoutMs = 1_000

    const failure = await failureOf(
      acquireHomeWorkerConfigLease(userDataPath, {
        timeoutMs,
        dependencies: {
          token: () => 'contender',
          platform: 'win32',
          isProcessAlive: () => false,
          now: clock.now,
          wait: clock.wait,
          rename: reclaimThatCapturesAChangedLease(lockPath, Number.POSITIVE_INFINITY),
        },
      }),
    )

    expect(failure?.message).toContain('changed during ownership verification')
    expect(failure?.cause?.code).toBe('EPERM')
    // The acquisition deadline plus at most one backoff step, not a window of its own.
    expect(clock.now() - startedAt).toBeLessThanOrEqual(timeoutMs + 100)
  }, 10_000)

  it('16 retries a restore that fails once with EPERM and goes on', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = await writeDeadOwnerLease(userDataPath)
    const clock = createFakeClock()

    const failure = await failureOf(
      acquireHomeWorkerConfigLease(userDataPath, {
        timeoutMs: 1_000,
        dependencies: {
          token: () => 'contender',
          platform: 'win32',
          isProcessAlive: pid => pid === 999_998,
          now: clock.now,
          wait: clock.wait,
          rename: reclaimThatCapturesAChangedLease(lockPath, 1),
        },
      }),
    )

    // The restore waited once and put the changed lease (a live owner now) back, so the
    // acquisition ends in an ordinary timeout against it.
    expect(failure?.message).toContain('Timed out acquiring')
    expect(clock.waits.length).toBeGreaterThanOrEqual(2)
    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('"other"')
  }, 10_000)

  it('17 checks the deadline after a successful reclaim before the next claim', async () => {
    const userDataPath = await createUserDataPath()
    await writeDeadOwnerLease(userDataPath)
    let clock = 1_000_000
    let claims = 0

    const failure = await failureOf(
      acquireHomeWorkerConfigLease(userDataPath, {
        timeoutMs: 1_000,
        dependencies: {
          token: () => 'contender',
          platform: 'linux',
          isProcessAlive: () => false,
          now: () => clock,
          wait: async () => undefined,
          rm: async (path, options) => {
            // Removing the quarantine takes longer than the whole deadline.
            if (path.includes('.stale-')) {
              clock += 2_000
            }
            await rm(path, options)
          },
          rename: async (from, to) => {
            if (to === resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)) {
              claims += 1
            }
            await rename(from, to)
          },
        },
      }),
    )

    expect(failure?.message).toContain('Timed out acquiring')
    // One claim before the reclaim; none after the deadline passed.
    expect(claims).toBe(1)
  }, 10_000)
})
