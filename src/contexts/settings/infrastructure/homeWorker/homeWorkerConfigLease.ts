import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

export const HOME_WORKER_CONFIG_LEASE_FILE = 'home-worker-config.lease'
const DEFAULT_LEASE_TIMEOUT_MS = 5_000
const DEFAULT_RETRY_DELAY_MS = 25

type LeaseRecord = { pid: number; token: string; createdAt: string }

type LeaseDependencies = {
  now?: () => number
  wait?: (delayMs: number) => Promise<void>
  isProcessAlive?: (pid: number) => boolean
  token?: () => string
}

function parseLeaseRecord(value: string): LeaseRecord | null {
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

async function removeStaleLease(lockPath: string, observedRaw: string): Promise<boolean> {
  const currentRaw = await readFile(lockPath, 'utf8').catch(() => null)
  if (currentRaw !== observedRaw) {
    return false
  }
  await rm(lockPath, { force: true })
  return true
}

export async function acquireHomeWorkerConfigLease(
  userDataPath: string,
  options: {
    timeoutMs?: number
    retryDelayMs?: number
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
  const token = createToken()

  const attempt = async (): Promise<{ release: () => Promise<void> }> => {
    try {
      await mkdir(userDataPath, { recursive: true })
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, token, createdAt: new Date(now()).toISOString() })}\n`,
          'utf8',
        )
      } finally {
        await handle.close().catch(() => undefined)
      }
      return {
        release: async () => {
          const current = await readFile(lockPath, 'utf8').catch(() => null)
          if (current && parseLeaseRecord(current)?.token === token) {
            await rm(lockPath, { force: true }).catch(() => undefined)
          }
        },
      }
    } catch (error) {
      const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
      if (code !== 'EEXIST') {
        throw error
      }
      const observedRaw = await readFile(lockPath, 'utf8').catch(() => null)
      const observed = observedRaw ? parseLeaseRecord(observedRaw) : null
      if (observedRaw && observed && !isProcessAlive(observed.pid)) {
        await removeStaleLease(lockPath, observedRaw).catch(() => false)
      }
      if (now() >= deadline) {
        throw new Error('Timed out acquiring Home Worker configuration lease.', { cause: error })
      }
      await wait(retryDelayMs)
      return await attempt()
    }
  }

  return await attempt()
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
