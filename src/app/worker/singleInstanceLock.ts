import { legacyWorkerBlocksAcquisition } from '../../platform/process/workerProcessIdentity'
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { acquireWorkerOwnerLock } from '../../platform/process/workerOwnerLock'
import {
  readWorkerLockMetadata,
  resolveWorkerSingleInstanceLockPath,
} from '../../platform/process/workerSingleInstanceLockFile'

export async function acquireWorkerSingleInstanceLock(
  userDataPath: string,
): Promise<
  | { status: 'acquired'; release: () => Promise<void> }
  | { status: 'existing'; existingPid: number | null }
> {
  const owner = acquireWorkerOwnerLock(userDataPath)
  if (owner.status === 'busy') {
    return {
      status: 'existing',
      existingPid: (await readWorkerLockMetadata(userDataPath))?.pid ?? null,
    }
  }
  try {
    // @compat legacy-worker-process-identity
    // A held kernel lease proves new-format metadata stale; legacy owners need identity checks.
    const previous = await readWorkerLockMetadata(userDataPath)
    // @compat legacy-worker-process-identity
    if (previous && (await legacyWorkerBlocksAcquisition(previous, userDataPath))) {
      owner.release()
      return { status: 'existing', existingPid: previous.pid }
    }
    const instanceId = randomUUID()
    const lockPath = resolveWorkerSingleInstanceLockPath(userDataPath)
    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: process.pid, instanceId, createdAt: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    )
    let releasing: Promise<void> | null = null
    return {
      status: 'acquired',
      release: () => {
        releasing ??= (async () => {
          try {
            const current = await readWorkerLockMetadata(userDataPath)
            if (current?.pid === process.pid && current.instanceId === instanceId) {
              await rm(lockPath, { force: true })
            }
          } finally {
            owner.release()
          }
        })()
        return releasing
      },
    }
  } catch (error) {
    owner.release()
    throw error
  }
}
