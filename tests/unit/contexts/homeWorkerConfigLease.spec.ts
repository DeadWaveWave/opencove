import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireHomeWorkerConfigLease,
  HOME_WORKER_CONFIG_LEASE_FILE,
  HOME_WORKER_CONFIG_LEASE_OWNER_FILE,
} from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'

const cleanupPaths: string[] = []

function deferred() {
  let resolvePromise!: () => void
  const promise = new Promise<void>(resolveDeferred => {
    resolvePromise = resolveDeferred
  })
  return { promise, resolve: resolvePromise }
}

function ownerPath(userDataPath: string): string {
  return resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE, HOME_WORKER_CONFIG_LEASE_OWNER_FILE)
}

async function createUserDataPath(): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), 'opencove-home-worker-config-lease-'))
  cleanupPaths.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map(async path => await rm(path, { recursive: true })))
})

describe('Home Worker configuration lease', () => {
  it('serializes two process owners until the exact holder releases', async () => {
    const userDataPath = await createUserDataPath()
    const first = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: { token: () => 'first-owner' },
    })
    const retryObserved = deferred()
    const allowRetry = deferred()
    const secondLease = acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: {
        token: () => 'second-owner',
        wait: async () => {
          retryObserved.resolve()
          await allowRetry.promise
        },
      },
    })
    await retryObserved.promise

    let secondAcquired = false
    void secondLease.then(() => {
      secondAcquired = true
    })
    expect(secondAcquired).toBe(false)

    await first.release()
    allowRetry.resolve()
    const second = await secondLease
    expect(secondAcquired).toBe(true)
    await second.release()
  })

  it('does not let a stale release delete a replacement owner', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const first = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: { token: () => 'first-owner' },
    })
    await rm(lockPath, { recursive: true })
    const second = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: { token: () => 'second-owner' },
    })

    await first.release()

    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('second-owner')
    await second.release()
  })

  it('reclaims only a lease whose recorded process is no longer alive', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    await mkdir(lockPath)
    await writeFile(
      ownerPath(userDataPath),
      `${JSON.stringify({ pid: 999_999, token: 'stale', createdAt: '2026-01-01T00:00:00.000Z' })}\n`,
    )

    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      retryDelayMs: 0,
      dependencies: {
        token: () => 'replacement',
        isProcessAlive: () => false,
        wait: async () => undefined,
      },
    })

    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('replacement')
    await lease.release()
  })

  it('does not steal a recent malformed claim that may still be publishing its owner', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    await mkdir(lockPath)
    await writeFile(ownerPath(userDataPath), 'partial-owner-record')

    await expect(
      acquireHomeWorkerConfigLease(userDataPath, {
        timeoutMs: 0,
        malformedStaleMs: 5_000,
        dependencies: {
          token: () => 'contender',
          wait: async () => undefined,
        },
      }),
    ).rejects.toThrow('Timed out acquiring')
    expect(await readFile(ownerPath(userDataPath), 'utf8')).toBe('partial-owner-record')
  })

  it('recovers an old malformed claim only after its stale boundary', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    await mkdir(lockPath)
    await writeFile(ownerPath(userDataPath), 'partial-owner-record')

    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      malformedStaleMs: 0,
      dependencies: {
        token: () => 'recovered-owner',
        wait: async () => undefined,
      },
    })

    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('recovered-owner')
    await lease.release()
  })
})
