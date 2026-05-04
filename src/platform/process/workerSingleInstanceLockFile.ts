import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

export const WORKER_LOCK_FILE = 'opencove-worker.lock'

export function resolveWorkerSingleInstanceLockPath(userDataPath: string): string {
  return resolve(userDataPath, WORKER_LOCK_FILE)
}

export async function removeWorkerSingleInstanceLock(userDataPath: string): Promise<void> {
  await rm(resolveWorkerSingleInstanceLockPath(userDataPath), { force: true })
}
