import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { acquireWorkerSingleInstanceLock } from '../../../src/app/worker/singleInstanceLock'

const LOCK_FILE_NAME = 'opencove-worker.lock'

describe('acquireWorkerSingleInstanceLock', () => {
  let userDataDir: string | null = null

  afterEach(async () => {
    if (!userDataDir) {
      return
    }

    await rm(userDataDir, { recursive: true, force: true })
    userDataDir = null
  })

  async function createTempUserDataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'opencove-test-worker-lock-'))
    userDataDir = dir
    return dir
  }

  it('acquires and releases the lock', async () => {
    const dir = await createTempUserDataDir()
    const lock = await acquireWorkerSingleInstanceLock(dir)

    expect(lock.status).toBe('acquired')
    if (lock.status !== 'acquired') {
      return
    }

    const lockPath = resolve(dir, LOCK_FILE_NAME)
    const raw = await readFile(lockPath, 'utf8')
    expect(raw).toContain('"pid"')

    await lock.release()
    await expect(readFile(lockPath, 'utf8')).rejects.toBeDefined()
  })

  it('returns existing when another instance holds the lock', async () => {
    const dir = await createTempUserDataDir()
    const first = await acquireWorkerSingleInstanceLock(dir)
    expect(first.status).toBe('acquired')

    const second = await acquireWorkerSingleInstanceLock(dir)
    expect(second.status).toBe('existing')
    if (second.status === 'existing') {
      expect(second.existingPid).toBe(process.pid)
    }

    if (first.status === 'acquired') {
      await first.release()
    }
  })

  it('removes stale lock files and acquires', async () => {
    const dir = await createTempUserDataDir()
    const lockPath = resolve(dir, LOCK_FILE_NAME)
    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: 999_999, createdAt: new Date(0).toISOString() })}\n`,
      'utf8',
    )

    const lock = await acquireWorkerSingleInstanceLock(dir)
    expect(lock.status).toBe('acquired')

    if (lock.status === 'acquired') {
      await lock.release()
    }
  })
})
