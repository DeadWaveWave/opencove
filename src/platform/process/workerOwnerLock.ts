import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export type WorkerOwnerLock = { status: 'acquired'; release: () => void } | { status: 'busy' }

/** This file is permanent: unlinking it would create a second locking domain. */
export function acquireWorkerOwnerLock(userDataPath: string): WorkerOwnerLock {
  mkdirSync(userDataPath, { recursive: true })
  const db = new Database(resolve(userDataPath, 'opencove-worker-owner.lock.db'), { timeout: 0 })
  try {
    db.pragma('busy_timeout = 0')
    db.pragma('locking_mode = EXCLUSIVE')
    db.exec('BEGIN EXCLUSIVE; COMMIT;')
    return {
      status: 'acquired',
      release: () => {
        if (db.open) {
          db.close()
        }
      },
    }
  } catch (error) {
    db.close()
    if ((error as { code?: string }).code === 'SQLITE_BUSY') {
      return { status: 'busy' }
    }
    throw error
  }
}
