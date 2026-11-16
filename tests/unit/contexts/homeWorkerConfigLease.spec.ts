import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acquireHomeWorkerConfigLease,
  HOME_WORKER_CONFIG_LEASE_FILE,
  createLeaseReleaseErrorReporter,
  withHomeWorkerConfigLease,
  type HomeWorkerConfigLeaseDependencies,
} from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'
import {
  createFakeClock,
  createUserDataPath,
  exists,
  fsError,
  ownerPath,
  registerHomeWorkerConfigLeaseCases,
  registerLeaseTempDirCleanup,
} from './homeWorkerConfigLease.helpers'

registerHomeWorkerConfigLeaseCases()

describe('Home Worker configuration lease under Windows error codes', () => {
  registerLeaseTempDirCleanup()

  it('1 reclaims a dead owner found after a win32 EPERM on the claim, without waiting', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const waits: number[] = []
    let injected = false

    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'reclaiming-owner',
        platform: 'win32',
        isProcessAlive: () => false,
        wait: async delayMs => {
          waits.push(delayMs)
        },
        // The path is free when the claim looks, then a dead owner's lease appears and the claim
        // reports EPERM, so only the check after the ambiguous code can see the dead owner.
        rename: async (from, to) => {
          if (to === lockPath && !injected) {
            injected = true
            await mkdir(lockPath)
            await writeFile(
              ownerPath(userDataPath),
              `${JSON.stringify({ pid: 999_999, token: 'dead', createdAt: '2026-01-01T00:00:00.000Z' })}\n`,
            )
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    })

    expect(injected).toBe(true)
    expect(waits).toEqual([])
    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('reclaiming-owner')
    await lease.release()
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
    // The message is what reaches the log, so it carries the details.
    expect(failure?.message).toContain('attempts=')
    expect(failure?.message).toContain('lastCode=EPERM')
    expect(failure?.message).toContain('lastObservation=absent')
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
      (error: unknown) => error as Error & { cause?: { code?: string } },
    )

    expect(failure).not.toBeNull()
    expect(failure?.message).toContain('lease claim failed')
    expect(failure?.cause?.code).toBe('EPERM')
    expect(waits).toEqual([])
  }, 10_000)

  it('4b keeps EPERM fatal on Linux for a reclaim and names the operation', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    await mkdir(lockPath)
    await writeFile(
      ownerPath(userDataPath),
      `${JSON.stringify({ pid: 999_999, token: 'dead', createdAt: '2026-01-01T00:00:00.000Z' })}\n`,
    )
    const waits: number[] = []

    const failure = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'linux-owner',
        platform: 'linux',
        isProcessAlive: () => false,
        wait: async delayMs => {
          waits.push(delayMs)
        },
        rename: async (from, to) => {
          if (from === lockPath) {
            throw fsError('EPERM')
          }
          await rename(from, to)
        },
      },
    }).then(
      () => null,
      (error: unknown) => error as Error & { cause?: { code?: string } },
    )

    expect(failure?.message).toContain('lease reclaim failed')
    expect(failure?.cause?.code).toBe('EPERM')
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

  it('8 leaves a replacement owner in place when a retried release captures the replaced lease', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    let releaseRenames = 0
    let swapped = false
    const first = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'first-owner',
        platform: 'win32',
        now: clock.now,
        wait: clock.wait,
        rename: async (from, to) => {
          if (from === lockPath) {
            releaseRenames += 1
            if (releaseRenames === 1) {
              throw fsError('EPERM')
            }
            // The retried rename captures whatever is at the lease path by then: a replacement
            // that took over after the release last looked.
            swapped = true
            await rm(lockPath, { recursive: true })
            await acquireHomeWorkerConfigLease(userDataPath, {
              dependencies: { token: () => 'second-owner' },
            })
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
})

describe('Worker start-up under the configuration lease', () => {
  registerLeaseTempDirCleanup()

  it('10 logs a failed release through the Worker reporter and lets start-up continue', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const clock = createFakeClock()
    const stderr: string[] = []

    // The Worker entry cannot be imported in a unit test, so this drives the same call it makes:
    // withHomeWorkerConfigLease with the shared reporter, labelled for the Worker.
    const result = await withHomeWorkerConfigLease(userDataPath, async () => 'ready', {
      onReleaseError: createLeaseReleaseErrorReporter('opencove-worker', text => stderr.push(text)),
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

    expect(result).toBe('ready')
    expect(stderr).toHaveLength(1)
    expect(stderr[0]).toContain('[opencove-worker] Home Worker configuration lease release failed')
  }, 10_000)

  it('10 keeps the Worker entry and the router reporting a release failure to stderr', async () => {
    const entry = await readFile(resolve('src/app/worker/index.ts'), 'utf8')
    const router = await readFile(
      resolve('src/app/main/worker/homeWorkerConfigurationRouter.ts'),
      'utf8',
    )

    expect(entry).toMatch(
      /withHomeWorkerConfigLease\(userDataPath, startServer, \{\s*releaseTimeoutMs: WORKER_LEASE_RELEASE_TIMEOUT_MS,\s*onReleaseError: createLeaseReleaseErrorReporter\('opencove-worker', text =>\s*process\.stderr\.write\(text\),?\s*\)/,
    )
    expect(router).toMatch(
      /onReleaseError: createLeaseReleaseErrorReporter\('opencove', text =>\s*process\.stderr\.write\(text\),?\s*\)/,
    )
  })
})

describe('Home Worker configuration lease file system access', () => {
  it('12 reaches rename and rm only through the injected file system port', async () => {
    const source = await readFile(
      resolve('src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease.ts'),
      'utf8',
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    // The defaults live in a sibling module, so the lease module imports no file system function
    // that could be called around the port: only named imports other than rename and rm, and no
    // namespace or default import of the file system modules.
    const fileSystemImports = [
      ...code.matchAll(/import\s+(?!type\b)([^'"]*?)\s+from\s+'node:fs(?:\/promises)?'/g),
    ].map(match => match[1])
    for (const clause of fileSystemImports) {
      expect(clause).toMatch(/^\{[^}]*\}$/)
      expect(clause).not.toMatch(/\b(rename|rm)\b/)
    }
    // A bare call, or a call through any receiver but the port, skips the platform policy.
    expect(code.match(/(?<![\w$.])(rename|rm)\s*\(/g)).toBeNull()
    const receivers = [...code.matchAll(/([\w$.]*)\.(?:rename|rm)\s*\(/g)].map(match => match[1])
    expect(receivers.length).toBeGreaterThan(0)
    expect(receivers.filter(receiver => receiver !== 'fs' && receiver !== 'options.fs')).toEqual([])
  })
})
