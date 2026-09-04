import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const HOME_WORKER_CONFIG_LEASE_FILE = 'home-worker-config.lease'
export const HOME_WORKER_CONFIG_LEASE_OWNER_FILE = 'owner.json'
const DEFAULT_LEASE_TIMEOUT_MS = 5_000
const DEFAULT_RETRY_DELAY_MS = 25
const DEFAULT_MALFORMED_STALE_MS = 5_000

type LeaseRecord = { pid: number; token: string; createdAt: string }
type LeaseObservation = {
  identity: string
  mtimeMs: number
  record: LeaseRecord | null
}
type LeaseDependencies = {
  now?: () => number
  wait?: (delayMs: number) => Promise<void>
  isProcessAlive?: (pid: number) => boolean
  token?: () => string
}

function parseLeaseRecord(value: string | null): LeaseRecord | null {
  if (value === null) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const record = parsed as Record<string, unknown>
    if (
      !Number.isSafeInteger(record.pid) ||
      (record.pid as number) <= 0 ||
      typeof record.token !== 'string' ||
      record.token.length === 0 ||
      typeof record.createdAt !== 'string'
    ) {
      return null
    }
    return record as LeaseRecord
  } catch {
    return null
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function defaultWait(delayMs: number): Promise<void> {
  await new Promise<void>(resolvePromise => setTimeout(resolvePromise, delayMs))
}

async function observeLease(lockPath: string): Promise<LeaseObservation | null> {
  try {
    const metadata = await stat(lockPath)
    const ownerPath = resolve(lockPath, HOME_WORKER_CONFIG_LEASE_OWNER_FILE)
    const raw = metadata.isDirectory() ? await readFile(ownerPath, 'utf8').catch(() => null) : null
    return {
      identity: [metadata.dev, metadata.ino, metadata.mtimeMs, raw ?? 'malformed'].join(':'),
      mtimeMs: metadata.mtimeMs,
      record: parseLeaseRecord(raw),
    }
  } catch {
    return null
  }
}

async function restoreCapturedLease(capturedPath: string, lockPath: string): Promise<void> {
  await rename(capturedPath, lockPath).catch(async restoreError => {
    throw new Error('Home Worker configuration lease changed during ownership verification.', {
      cause: restoreError,
    })
  })
}

async function reclaimObservedLease(options: {
  lockPath: string
  observed: LeaseObservation
  quarantinePath: string
}): Promise<boolean> {
  try {
    await rename(options.lockPath, options.quarantinePath)
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
    if (code === 'ENOENT') {
      return false
    }
    throw error
  }
  const captured = await observeLease(options.quarantinePath)
  if (captured?.identity !== options.observed.identity) {
    await restoreCapturedLease(options.quarantinePath, options.lockPath)
    return false
  }
  await rm(options.quarantinePath, { recursive: true, force: true })
  return true
}

export async function acquireHomeWorkerConfigLease(
  userDataPath: string,
  options: {
    timeoutMs?: number
    retryDelayMs?: number
    malformedStaleMs?: number
    dependencies?: LeaseDependencies
  } = {},
): Promise<{ release: () => Promise<void> }> {
  const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
  const now = options.dependencies?.now ?? Date.now
  const wait = options.dependencies?.wait ?? defaultWait
  const isProcessAlive = options.dependencies?.isProcessAlive ?? defaultIsProcessAlive
  const createToken = options.dependencies?.token ?? randomUUID
  const deadline = now() + (options.timeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS)
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const malformedStaleMs = options.malformedStaleMs ?? DEFAULT_MALFORMED_STALE_MS
  const token = createToken()
  const owner: LeaseRecord = { pid: process.pid, token, createdAt: new Date(now()).toISOString() }
  const claimPath = `${lockPath}.claim-${process.pid}-${token}`

  await mkdir(userDataPath, { recursive: true })
  await rm(claimPath, { recursive: true, force: true })
  await mkdir(claimPath)
  await writeFile(
    resolve(claimPath, HOME_WORKER_CONFIG_LEASE_OWNER_FILE),
    `${JSON.stringify(owner)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )

  const attempt = async (): Promise<{ release: () => Promise<void> }> => {
    try {
      await rename(claimPath, lockPath)
      return {
        release: async () => {
          const observed = await observeLease(lockPath)
          if (observed?.record?.token !== token) {
            return
          }
          const releasePath = `${lockPath}.release-${process.pid}-${token}`
          await rm(releasePath, { recursive: true, force: true })
          try {
            await rename(lockPath, releasePath)
          } catch {
            return
          }
          const captured = await observeLease(releasePath)
          if (captured?.record?.token === token) {
            await rm(releasePath, { recursive: true, force: true })
          } else {
            await restoreCapturedLease(releasePath, lockPath)
          }
        },
      }
    } catch (error) {
      const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'ENOTDIR' && code !== 'EISDIR') {
        throw error
      }
      const observed = await observeLease(lockPath)
      if (!observed) {
        return await attempt()
      }
      const malformedIsStale = !observed.record && now() - observed.mtimeMs >= malformedStaleMs
      const ownerExited = observed.record ? !isProcessAlive(observed.record.pid) : false
      if (ownerExited || malformedIsStale) {
        const quarantinePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`
        if (
          await reclaimObservedLease({
            lockPath,
            observed,
            quarantinePath,
          })
        ) {
          return await attempt()
        }
      }
      if (now() >= deadline) {
        throw new Error('Timed out acquiring Home Worker configuration lease.', { cause: error })
      }
      await wait(retryDelayMs)
      return await attempt()
    }
  }

  try {
    return await attempt()
  } catch (error) {
    await rm(claimPath, { recursive: true, force: true })
    throw error
  }
}

export async function withHomeWorkerConfigLease<T>(
  userDataPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lease = await acquireHomeWorkerConfigLease(userDataPath)
  try {
    return await operation()
  } finally {
    await lease.release()
  }
}
