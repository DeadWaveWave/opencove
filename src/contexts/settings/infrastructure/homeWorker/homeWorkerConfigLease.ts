import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename as fsRename, rm as fsRm, stat, writeFile } from 'node:fs/promises'
import type { RmOptions } from 'node:fs'
import { resolve } from 'node:path'
import {
  classifyLeaseFsError,
  readFsErrorCode,
  type LeaseOperation,
} from './homeWorkerConfigLeaseErrors'

export const HOME_WORKER_CONFIG_LEASE_FILE = 'home-worker-config.lease'
export const HOME_WORKER_CONFIG_LEASE_OWNER_FILE = 'owner.json'
const DEFAULT_LEASE_TIMEOUT_MS = 5_000
const DEFAULT_RETRY_DELAY_MS = 25
const DEFAULT_MALFORMED_STALE_MS = 5_000
const RELEASE_TIMEOUT_MS = 5_000
// Node retries EBUSY, EMFILE, ENFILE, ENOTEMPTY and EPERM in recursive mode.
const RM_RETRY_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as const

type LeaseRecord = { pid: number; token: string; createdAt: string }
type LeaseObservation = {
  identity: string
  mtimeMs: number
  record: LeaseRecord | null
}
type LeaseFileSystem = {
  platform: NodeJS.Platform
  rename: (from: string, to: string) => Promise<void>
  rm: (path: string, options?: RmOptions) => Promise<void>
}
type LeaseTiming = {
  now: () => number
  wait: (delayMs: number) => Promise<void>
  retryDelayMs: number
  timeoutMs: number
}
export type HomeWorkerConfigLeaseDependencies = {
  now?: () => number
  wait?: (delayMs: number) => Promise<void>
  isProcessAlive?: (pid: number) => boolean
  token?: () => string
  platform?: NodeJS.Platform
  rename?: (from: string, to: string) => Promise<void>
  rm?: (path: string, options?: RmOptions) => Promise<void>
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

type LeaseAcquireDetails = {
  attempts: number
  lastCode: string | null
  lastObservation: 'absent' | { pid: number | null; alive: boolean | null; malformed: boolean }
}

class HomeWorkerConfigLeaseTimeoutError extends Error {
  readonly details: LeaseAcquireDetails

  constructor(cause: unknown, details: LeaseAcquireDetails) {
    super('Timed out acquiring Home Worker configuration lease.', { cause })
    this.name = 'HomeWorkerConfigLeaseTimeoutError'
    this.details = details
  }
}

function fatalLeaseError(operation: LeaseOperation, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`Home Worker configuration lease ${operation} failed: ${detail}`, {
    cause: error,
  })
}

class HomeWorkerConfigLeaseReleaseError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Home Worker configuration lease release failed: ${detail}`, { cause })
    this.name = 'HomeWorkerConfigLeaseReleaseError'
  }
}

async function removeTree(fs: LeaseFileSystem, path: string): Promise<void> {
  await fs.rm(path, RM_RETRY_OPTIONS)
}

// Authority has already moved when this runs, and the leftover sits under a unique name, so a
// failure here must not fail the operation or mask an earlier error.
async function removeTreeQuietly(fs: LeaseFileSystem, path: string): Promise<void> {
  await removeTree(fs, path).catch(() => undefined)
}

// Starts at the configured delay and grows by 10 ms to 100 ms, as graceful-fs and VS Code do.
function nextBackoffMs(currentMs: number): number {
  return Math.min(100, currentMs + 10)
}

async function defaultWait(delayMs: number): Promise<void> {
  await new Promise<void>(resolvePromise => setTimeout(resolvePromise, delayMs))
}

async function observeLease(lockPath: string): Promise<LeaseObservation | null> {
  try {
    const metadata = await stat(lockPath)
    const ownerPath = resolve(lockPath, HOME_WORKER_CONFIG_LEASE_OWNER_FILE)
    const raw = metadata.isDirectory()
      ? await readFile(ownerPath, 'utf8').catch(() => null)
      : metadata.isFile()
        ? await readFile(lockPath, 'utf8').catch(() => null)
        : null
    return {
      identity: [
        metadata.dev,
        metadata.ino,
        metadata.mtimeMs,
        metadata.isDirectory()
          ? 'directory'
          : /* @compat home-worker-config-legacy-lease */ 'legacy-file',
        raw ?? 'malformed',
      ].join(':'),
      mtimeMs: metadata.mtimeMs,
      record: parseLeaseRecord(raw),
    }
  } catch {
    return null
  }
}

async function restoreCapturedLease(
  fs: LeaseFileSystem,
  timing: LeaseTiming,
  capturedPath: string,
  lockPath: string,
): Promise<void> {
  // The window is at least the acquisition deadline: the captured owner's directory is stranded if
  // the restore gives up.
  const deadline = timing.now() + Math.max(timing.timeoutMs, DEFAULT_LEASE_TIMEOUT_MS)
  let backoffMs = timing.retryDelayMs
  for (;;) {
    try {
      await fs.rename(capturedPath, lockPath)
      return
    } catch (restoreError) {
      const kind = classifyLeaseFsError('restore', readFsErrorCode(restoreError), fs.platform)
      const lockIsFree = kind === 'ambiguous' && (await observeLease(lockPath)) === null
      if (!lockIsFree || timing.now() >= deadline) {
        throw new Error(
          'Home Worker configuration lease restore failed: changed during ownership verification.',
          { cause: restoreError },
        )
      }
      await timing.wait(backoffMs)
      backoffMs = nextBackoffMs(backoffMs)
    }
  }
}

async function reclaimObservedLease(options: {
  fs: LeaseFileSystem
  timing: LeaseTiming
  lockPath: string
  observed: LeaseObservation
  quarantinePath: string
}): Promise<boolean> {
  try {
    await options.fs.rename(options.lockPath, options.quarantinePath)
  } catch (error) {
    const kind = classifyLeaseFsError('reclaim', readFsErrorCode(error), options.fs.platform)
    if (kind === 'absent' || kind === 'ambiguous') {
      return false
    }
    throw fatalLeaseError('reclaim', error)
  }
  const captured = await observeLease(options.quarantinePath)
  if (captured?.identity !== options.observed.identity) {
    await restoreCapturedLease(options.fs, options.timing, options.quarantinePath, options.lockPath)
    return false
  }
  await removeTreeQuietly(options.fs, options.quarantinePath)
  return true
}

export async function acquireHomeWorkerConfigLease(
  userDataPath: string,
  options: {
    timeoutMs?: number
    retryDelayMs?: number
    malformedStaleMs?: number
    dependencies?: HomeWorkerConfigLeaseDependencies
  } = {},
): Promise<{ release: () => Promise<void> }> {
  const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
  const now = options.dependencies?.now ?? Date.now
  const wait = options.dependencies?.wait ?? defaultWait
  const fs: LeaseFileSystem = {
    platform: options.dependencies?.platform ?? process.platform,
    rename: options.dependencies?.rename ?? fsRename,
    rm: options.dependencies?.rm ?? fsRm,
  }
  const isProcessAlive = options.dependencies?.isProcessAlive ?? defaultIsProcessAlive
  const createToken = options.dependencies?.token ?? randomUUID
  const deadline = now() + (options.timeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS)
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const malformedStaleMs = options.malformedStaleMs ?? DEFAULT_MALFORMED_STALE_MS
  const timing: LeaseTiming = {
    now,
    wait,
    retryDelayMs,
    timeoutMs: options.timeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS,
  }
  const token = createToken()
  const owner: LeaseRecord = { pid: process.pid, token, createdAt: new Date(now()).toISOString() }
  const claimPath = `${lockPath}.claim-${process.pid}-${token}`

  await mkdir(userDataPath, { recursive: true })
  await removeTree(fs, claimPath)
  await mkdir(claimPath)
  await writeFile(
    resolve(claimPath, HOME_WORKER_CONFIG_LEASE_OWNER_FILE),
    `${JSON.stringify(owner)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )

  const createHandle = (): { release: () => Promise<void> } => ({
    release: async () => {
      const releaseDeadline = now() + RELEASE_TIMEOUT_MS
      const releasePath = `${lockPath}.release-${process.pid}-${token}`
      let backoffMs = retryDelayMs
      try {
        await removeTree(fs, releasePath)
      } catch (error) {
        throw new HomeWorkerConfigLeaseReleaseError(error)
      }
      for (;;) {
        // Every pass looks again, so a lease that was reclaimed or replaced meanwhile is left alone.
        const observed = await observeLease(lockPath)
        if (observed?.record?.token !== token) {
          return
        }
        try {
          await fs.rename(lockPath, releasePath)
        } catch (error) {
          const kind = classifyLeaseFsError('release', readFsErrorCode(error), fs.platform)
          if (kind === 'absent') {
            return
          }
          if (kind !== 'ambiguous' || now() >= releaseDeadline) {
            throw new HomeWorkerConfigLeaseReleaseError(error)
          }
          await wait(backoffMs)
          backoffMs = nextBackoffMs(backoffMs)
          continue
        }
        const captured = await observeLease(releasePath)
        if (captured?.record?.token === token) {
          await removeTreeQuietly(fs, releasePath)
        } else {
          await restoreCapturedLease(fs, timing, releasePath, lockPath)
        }
        return
      }
    },
  })

  const acquire = async (): Promise<{ release: () => Promise<void> }> => {
    let attempts = 0
    let lastError: unknown = null
    let lastCode: string | null = null
    let lastObservation: LeaseAcquireDetails['lastObservation'] = 'absent'
    let backoffMs = retryDelayMs
    for (;;) {
      attempts += 1
      let observed: LeaseObservation | null = null
      if (fs.platform === 'win32') {
        // On Windows a rename onto a held lease directory reports EPERM, and a rename onto a legacy
        // lease file succeeds and replaces it, so the rename cannot detect a held lease there. Look
        // first and claim only a free path. A legacy file that appears between this look and the
        // rename is still replaced; that needs an old build to take the lease in that instant.
        observed = await observeLease(lockPath)
      }
      if (!observed) {
        try {
          await fs.rename(claimPath, lockPath)
          return createHandle()
        } catch (error) {
          const code = readFsErrorCode(error)
          const kind = classifyLeaseFsError('claim', code, fs.platform)
          if (kind !== 'held' && kind !== 'ambiguous') {
            throw fatalLeaseError('claim', error)
          }
          lastError = error
          lastCode = code
          // Held, or ambiguous on Windows: the lease on disk tells which. Absent means a transient
          // refusal, which waits below instead of retrying at once.
          observed = await observeLease(lockPath)
        }
      }
      if (observed) {
        const malformedIsStale = !observed.record && now() - observed.mtimeMs >= malformedStaleMs
        const ownerAlive = observed.record ? isProcessAlive(observed.record.pid) : null
        lastObservation = {
          pid: observed.record?.pid ?? null,
          alive: ownerAlive,
          malformed: !observed.record,
        }
        if (ownerAlive === false || malformedIsStale) {
          const quarantinePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`
          if (await reclaimObservedLease({ fs, timing, lockPath, observed, quarantinePath })) {
            continue
          }
        }
      } else {
        lastObservation = 'absent'
      }
      if (now() >= deadline) {
        throw new HomeWorkerConfigLeaseTimeoutError(lastError, {
          attempts,
          lastCode,
          lastObservation,
        })
      }
      await wait(backoffMs)
      backoffMs = nextBackoffMs(backoffMs)
    }
  }

  try {
    return await acquire()
  } catch (error) {
    await removeTreeQuietly(fs, claimPath)
    throw error
  }
}

export async function withHomeWorkerConfigLease<T>(
  userDataPath: string,
  operation: () => Promise<T>,
  options: {
    // Called with a release failure. The operation's own outcome never changes because of it.
    onReleaseError?: (error: unknown) => void
    dependencies?: HomeWorkerConfigLeaseDependencies
  } = {},
): Promise<T> {
  const lease = await acquireHomeWorkerConfigLease(userDataPath, {
    dependencies: options.dependencies,
  })
  let result: T
  try {
    result = await operation()
  } catch (error) {
    // The operation's error wins; a release failure is reported, not allowed to replace it.
    await lease.release().catch((releaseError: unknown) => options.onReleaseError?.(releaseError))
    throw error
  }
  try {
    await lease.release()
  } catch (releaseError) {
    if (!options.onReleaseError) {
      throw releaseError
    }
    options.onReleaseError(releaseError)
  }
  return result
}
