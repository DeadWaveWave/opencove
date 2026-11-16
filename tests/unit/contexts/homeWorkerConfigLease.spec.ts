import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acquireHomeWorkerConfigLease,
  HOME_WORKER_CONFIG_LEASE_FILE,
  withHomeWorkerConfigLease,
  type HomeWorkerConfigLeaseDependencies,
} from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'
import {
  createUserDataPath,
  ownerPath,
  registerHomeWorkerConfigLeaseCases,
  registerLeaseTempDirCleanup,
} from './homeWorkerConfigLease.helpers'

registerHomeWorkerConfigLeaseCases()

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: injected filesystem error`), { code })
}

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(
    () => true,
    () => false,
  )
}

// A clock that only moves when the lease waits, so a retry loop without a wait cannot pass time.
function createFakeClock() {
  let current = 1_000_000
  const waits: number[] = []
  return {
    waits,
    now: () => current,
    wait: async (delayMs: number) => {
      waits.push(delayMs)
      current += delayMs
    },
  }
}

describe('Home Worker configuration lease under Windows error codes', () => {
  registerLeaseTempDirCleanup()

  it('1 waits for a held lease when the claim reports EPERM on win32', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const first = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: { token: () => 'first-owner' },
    })
    let released = false

    const second = await acquireHomeWorkerConfigLease(userDataPath, {
      timeoutMs: 5_000,
      dependencies: {
        token: () => 'second-owner',
        platform: 'win32',
        rename: async (from, to) => {
          if (to === lockPath && (await exists(lockPath))) {
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
        wait: async () => {
          if (!released) {
            released = true
            await first.release()
          }
        },
      },
    })

    expect(released).toBe(true)
    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('second-owner')
    await second.release()
  }, 10_000)

  it('2 retries with a wait each time when the claim reports EPERM on win32 and no lease exists', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    let failures = 0

    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'transient-owner',
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (to === lockPath && failures < 3) {
            failures += 1
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    })

    expect(failures).toBe(3)
    expect(clock.waits).toHaveLength(3)
    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('transient-owner')
    await lease.release()
  }, 10_000)

  it('3 times out with the last code and an absent observation on a permanent win32 EPERM', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    const timeoutMs = 5_000
    let renameCalls = 0

    const failure = await acquireHomeWorkerConfigLease(userDataPath, {
      timeoutMs,
      dependencies: {
        token: () => 'doomed-owner',
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (to === lockPath) {
            renameCalls += 1
            if (renameCalls > 1_000) {
              throw new Error('claim retried without reaching the deadline')
            }
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    }).then(
      () => null,
      (error: unknown) => error as Error & { cause?: { code?: string }; details?: unknown },
    )

    expect(failure?.message).toContain('Timed out acquiring')
    expect(failure?.cause?.code).toBe('EPERM')
    expect(failure?.details).toMatchObject({ lastCode: 'EPERM', lastObservation: 'absent' })
    // 25 ms is the smallest backoff step, so the deadline allows at most this many claims.
    expect(renameCalls).toBeLessThanOrEqual(timeoutMs / 25 + 2)
    expect(await exists(lockPath)).toBe(false)
  }, 10_000)

  it('4 keeps EPERM fatal on Linux and never waits', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const waits: number[] = []

    const failure = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'linux-owner',
        platform: 'linux',
        wait: async delayMs => {
          waits.push(delayMs)
        },
        rename: async (from, to) => {
          if (to === lockPath) {
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    }).then(
      () => null,
      (error: unknown) => error as { code?: string; cause?: { code?: string } },
    )

    expect(failure).not.toBeNull()
    // A fatal error may name its operation and carry the filesystem error as its cause.
    expect(failure?.code ?? failure?.cause?.code).toBe('EPERM')
    expect(waits).toEqual([])
  }, 10_000)

  it('5 reclaims a dead owner after one wait when the reclaim reports EPERM on win32', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    await mkdir(lockPath)
    await writeFile(
      ownerPath(userDataPath),
      `${JSON.stringify({ pid: 999_999, token: 'stale', createdAt: '2026-01-01T00:00:00.000Z' })}\n`,
    )
    const clock = createFakeClock()
    let reclaimFailures = 0

    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'replacement',
        platform: 'win32',
        isProcessAlive: () => false,
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (from === lockPath && reclaimFailures < 1) {
            reclaimFailures += 1
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    })

    expect(reclaimFailures).toBe(1)
    expect(clock.waits).toHaveLength(1)
    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('replacement')
    await lease.release()
  }, 10_000)

  it('6 retries a release that reports EPERM twice on win32 until the lease is gone', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    let releaseFailures = 0
    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'releasing-owner',
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (from === lockPath && releaseFailures < 2) {
            releaseFailures += 1
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    })

    await lease.release()

    expect(releaseFailures).toBe(2)
    expect(await exists(lockPath)).toBe(false)
  }, 10_000)

  it('7 rejects a release that keeps reporting EPERM on win32 instead of resolving silently', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    let releaseCalls = 0
    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'stuck-owner',
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (from === lockPath) {
            releaseCalls += 1
            if (releaseCalls > 1_000) {
              throw new Error('release retried without reaching the deadline')
            }
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    })

    // HomeWorkerConfigLeaseReleaseError does not exist yet, so the case matches it by name.
    await expect(lease.release()).rejects.toMatchObject({
      name: 'HomeWorkerConfigLeaseReleaseError',
      cause: { code: 'EPERM' },
    })
  }, 10_000)

  it('8 leaves a replacement owner in place when a retried release finds the lease replaced', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    let swapped = false
    const first = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'first-owner',
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (from === lockPath && !swapped) {
            swapped = true
            await rm(lockPath, { recursive: true })
            const replacement = await acquireHomeWorkerConfigLease(userDataPath, {
              dependencies: { token: () => 'second-owner' },
            })
            expect(replacement).toBeDefined()
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    })

    await first.release()

    expect(swapped).toBe(true)
    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('second-owner')
  }, 10_000)
})

describe('Home Worker configuration lease on a Windows legacy file lease', () => {
  registerLeaseTempDirCleanup()

  it('13 looks before claiming on win32 and never renames onto a live legacy lease file', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const legacy = `${JSON.stringify({
      pid: process.pid,
      token: 'legacy-live-owner',
      createdAt: new Date().toISOString(),
    })}\n`
    await writeFile(lockPath, legacy)
    const claimTargets: string[] = []

    const failure = await acquireHomeWorkerConfigLease(userDataPath, {
      timeoutMs: 0,
      malformedStaleMs: 0,
      dependencies: {
        token: () => 'new-owner',
        platform: 'win32',
        isProcessAlive: () => true,
        wait: async () => undefined,
        // Windows lets a directory replace a file, so this rename would succeed onto the lease.
        rename: async (from, to) => {
          claimTargets.push(to)
          await rm(to, { recursive: true, force: true })
          await rename(from, to)
        },
      },
    }).then(
      () => null,
      (error: unknown) => error as Error,
    )

    expect(failure?.message).toContain('Timed out acquiring')
    expect(claimTargets).not.toContain(lockPath)
    expect(await readFile(lockPath, 'utf8')).toBe(legacy)
  }, 10_000)
})

describe('withHomeWorkerConfigLease when the release fails', () => {
  registerLeaseTempDirCleanup()

  async function createStuckReleaseDependencies(
    userDataPath: string,
  ): Promise<HomeWorkerConfigLeaseDependencies> {
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    return {
      platform: 'win32',
      now: clock.now,
      wait: clock.wait,
      rename: async (from, to) => {
        if (from === lockPath) {
          throw fsError('EPERM')
        }
        await rename(from, to)
      },
    }
  }

  it('9 returns the operation result and reports the release error once', async () => {
    const userDataPath = await createUserDataPath()
    const reported: unknown[] = []

    const result = await withHomeWorkerConfigLease(userDataPath, async () => 'operation result', {
      dependencies: await createStuckReleaseDependencies(userDataPath),
      onReleaseError: error => reported.push(error),
    })

    expect(result).toBe('operation result')
    expect(reported).toHaveLength(1)
    expect(reported[0]).toMatchObject({ name: 'HomeWorkerConfigLeaseReleaseError' })
  }, 10_000)

  it('9 rethrows the operation error rather than the release error', async () => {
    const userDataPath = await createUserDataPath()
    const reported: unknown[] = []

    await expect(
      withHomeWorkerConfigLease(
        userDataPath,
        async () => {
          throw new Error('operation failed')
        },
        {
          dependencies: await createStuckReleaseDependencies(userDataPath),
          onReleaseError: error => reported.push(error),
        },
      ),
    ).rejects.toThrow('operation failed')
    expect(reported).toHaveLength(1)
  }, 10_000)

  it('9 rejects with the release error when nobody listens for it', async () => {
    const userDataPath = await createUserDataPath()

    await expect(
      withHomeWorkerConfigLease(userDataPath, async () => 'operation result', {
        dependencies: await createStuckReleaseDependencies(userDataPath),
      }),
    ).rejects.toMatchObject({ name: 'HomeWorkerConfigLeaseReleaseError' })
  }, 10_000)
})

describe('Home Worker configuration lease file system access', () => {
  it('12 reaches rename and rm only through the injected file system port', async () => {
    const source = await readFile(
      resolve('src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease.ts'),
      'utf8',
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    // A bare call, or a call of the imported default, would skip the platform policy and the port.
    expect(code.match(/(?<![\w.])(rename|rm|fsRename|fsRm)\s*\(/g)).toBeNull()
    // The imported functions appear once in the import and once as the port's default.
    expect(code.match(/\bfsRename\b/g)).toHaveLength(2)
    expect(code.match(/\bfsRm\b/g)).toHaveLength(2)
  })
})
