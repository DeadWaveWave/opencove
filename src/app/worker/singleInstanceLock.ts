import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveWorkerSingleInstanceLockPath } from '../../platform/process/workerSingleInstanceLockFile'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const raw = await readFile(lockPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return null
    }

    const pid = parsed.pid
    return typeof pid === 'number' && Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export async function acquireWorkerSingleInstanceLock(
  userDataPath: string,
): Promise<
  | { status: 'acquired'; release: () => Promise<void> }
  | { status: 'existing'; existingPid: number | null }
> {
  const lockPath = resolveWorkerSingleInstanceLockPath(userDataPath)

  const attemptAcquire = async (): Promise<
    | { status: 'acquired'; release: () => Promise<void> }
    | { status: 'exists'; existingPid: number | null }
    | { status: 'retry' }
  > => {
    try {
      await mkdir(dirname(lockPath), { recursive: true })
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
          'utf8',
        )
      } finally {
        await handle.close().catch(() => undefined)
      }

      return {
        status: 'acquired',
        release: async () => {
          await rm(lockPath, { force: true }).catch(() => undefined)
        },
      }
    } catch (error) {
      const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
      if (code !== 'EEXIST') {
        throw error
      }

      const existingPid = await readLockPid(lockPath)
      if (existingPid && isProcessAlive(existingPid)) {
        return { status: 'exists', existingPid }
      }

      await rm(lockPath, { force: true }).catch(() => undefined)
      return { status: 'retry' }
    }
  }

  const firstAttempt = await attemptAcquire()
  if (firstAttempt.status === 'acquired') {
    return firstAttempt
  }

  if (firstAttempt.status === 'exists') {
    return { status: 'existing', existingPid: firstAttempt.existingPid }
  }

  const secondAttempt = await attemptAcquire()
  if (secondAttempt.status === 'acquired') {
    return secondAttempt
  }

  if (secondAttempt.status === 'exists') {
    return { status: 'existing', existingPid: secondAttempt.existingPid }
  }

  return { status: 'existing', existingPid: null }
}
