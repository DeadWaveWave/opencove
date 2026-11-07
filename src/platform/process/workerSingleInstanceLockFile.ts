import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const WORKER_LOCK_FILE = 'opencove-worker.lock'

export function resolveWorkerSingleInstanceLockPath(userDataPath: string): string {
  return resolve(userDataPath, WORKER_LOCK_FILE)
}

export function isWorkerPidPossiblyAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

export async function readWorkerLockMetadata(userDataPath: string): Promise<{
  pid: number
  instanceId?: string
} | null> {
  try {
    const value = JSON.parse(
      await readFile(resolveWorkerSingleInstanceLockPath(userDataPath), 'utf8'),
    )
    return value && Number.isSafeInteger(value.pid) && value.pid > 0
      ? {
          pid: value.pid,
          ...(typeof value.instanceId === 'string' && value.instanceId.length > 0
            ? { instanceId: value.instanceId }
            : {}),
        }
      : null
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}
