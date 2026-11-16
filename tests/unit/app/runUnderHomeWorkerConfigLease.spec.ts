import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { HOME_WORKER_CONFIG_LEASE_FILE } from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'
import { runUnderHomeWorkerConfigLease } from '../../../src/app/worker/runUnderHomeWorkerConfigLease'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async path => await rm(path, { recursive: true, force: true })),
  )
})

it('10 logs a failed lease release and lets Worker start-up continue', async () => {
  const userDataPath = await mkdtemp(resolve(tmpdir(), 'opencove-worker-lease-startup-'))
  cleanupPaths.push(userDataPath)
  const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
  let clock = 1_000_000
  const stderr: string[] = []

  const result = await runUnderHomeWorkerConfigLease(userDataPath, async () => 'ready', {
    writeStderr: text => stderr.push(text),
    dependencies: {
      platform: 'win32',
      now: () => clock,
      wait: async delayMs => {
        clock += delayMs
      },
      rename: async (from, to) => {
        if (from === lockPath) {
          const error = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        await rename(from, to)
      },
    },
  })

  expect(result).toBe('ready')
  expect(stderr).toHaveLength(1)
  expect(stderr[0]).toContain('[opencove-worker] Home Worker configuration lease release failed')
}, 10_000)
