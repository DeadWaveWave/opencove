import { open, readFile, stat, unlink, type FileHandle } from 'node:fs/promises'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'

const STALE_AFTER_MS = 120_000

async function busyError(lockPath: string) {
  let pid: unknown = 'unknown'
  let age = 'unknown'
  try {
    age = `${Math.floor(Math.max(0, Date.now() - (await stat(lockPath)).mtimeMs) / 1000)}s`
    pid = JSON.parse(await readFile(lockPath, 'utf8')).pid ?? pid
  } catch {
    /* Owner metadata may not yet have been flushed by the winner. */
  }
  return Object.assign(
    new Error(
      `Launcher publication busy or inaccessible: ${lockPath}; owner pid=${pid}, age=${age}`,
    ),
    { code: 'EEXIST' },
  )
}

async function createOrBusy(lockPath: string): Promise<FileHandle> {
  try {
    return await open(lockPath, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw await busyError(lockPath)
    }
    throw error
  }
}

async function acquire(lockPath: string): Promise<FileHandle> {
  try {
    return await open(lockPath, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
    try {
      const observed = await stat(lockPath)
      const ageMs = Math.max(0, Date.now() - observed.mtimeMs)
      if (ageMs <= STALE_AFTER_MS) {
        throw await busyError(lockPath)
      }
      // Elect one reclaimer before rechecking: stat + unlink alone is not atomic.
      // A crashed claim is itself a lease, recovered under its own exclusive claim.
      return await withLockPath(`${lockPath}.reclaim`, async () => {
        try {
          const current = await stat(lockPath)
          if (current.ino === observed.ino && current.mtimeMs === observed.mtimeMs) {
            await unlink(lockPath)
          }
        } catch (inspectionError) {
          if ((inspectionError as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw inspectionError
          }
        }
        return await createOrBusy(lockPath)
      })
    } catch (inspectionError) {
      if ((inspectionError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw inspectionError
      }
    }
    // Exactly one exclusive-create retry, including if another contender removed the stale file.
    return await createOrBusy(lockPath)
  }
}

async function releaseOwned(lockPath: string, owner: string) {
  try {
    if ((await readFile(lockPath, 'utf8')) === owner) {
      await unlink(lockPath)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

async function withLockPath<T>(lockPath: string, publish: () => Promise<T>): Promise<T> {
  const owner = JSON.stringify({
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
    token: randomUUID(),
  })
  const handle = await acquire(lockPath)
  try {
    await handle.writeFile(owner)
    return await publish()
  } finally {
    await handle.close()
    await releaseOwned(lockPath, owner)
  }
}

/** Shared protocol with installers: mtime > 120s is stale; elect via .reclaim, recheck, create once.
 * Publication must finish within this lease. Release checks the owner record before deleting the lock.
 */
export async function withCliLauncherLock<T>(
  target: string,
  publish: () => Promise<T>,
): Promise<T> {
  return await withLockPath(`${target}.lock`, publish)
}
