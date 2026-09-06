/* eslint-disable no-await-in-loop -- Lifecycle probes must settle before the next probe. */
import { spawn } from 'node:child_process'
import { mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ManagedDeploymentPort } from '../../application/ports/ManagedDeploymentPort'
import { ManagedDeploymentStore } from './ManagedDeploymentStore'
import { snapshotManagedProfile } from './managedProfileSnapshot'
import {
  invokeManagedRuntime,
  probeManagedRuntime,
  type ManagedRuntimeConnection,
} from './managedRuntimeProbe'

export async function assertManagedProfileStopped(profile: string): Promise<void> {
  let raw: string
  try {
    raw = await readFile(join(profile, 'opencove-worker.lock'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  let pid: unknown
  try {
    pid = JSON.parse(raw).pid
  } catch {
    throw new Error('[opencove-bootstrap:runtime_busy] Worker ownership file is incomplete.')
  }
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('[opencove-bootstrap:runtime_busy] Worker ownership is unknown.')
  }
  try {
    process.kill(pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return
    }
    throw error
  }
  throw new Error('[opencove-bootstrap:runtime_busy] The profile still belongs to a live Worker.')
}

export async function createManagedDeploymentPort(options: {
  connection: ManagedRuntimeConnection
  profile: string
  state: string
}): Promise<ManagedDeploymentPort & { dispose: () => void }> {
  await mkdir(options.profile, { recursive: true, mode: 0o700 })
  const store = new ManagedDeploymentStore(options.state)
  const waitStopped = async (): Promise<void> => {
    const deadline = Date.now() + 20_000
    while (true) {
      try {
        await assertManagedProfileStopped(options.profile)
        return
      } catch (error) {
        if (Date.now() >= deadline) {
          throw error
        }
        await delay(100)
      }
    }
  }
  return {
    exclusive: operation => store.exclusive(operation),
    read: () => store.read(),
    write: record => store.write(record),
    dispose: () => store.dispose(),
    observe: async () => {
      const value = await probeManagedRuntime(options.connection)
      if (!value) {
        await assertManagedProfileStopped(options.profile)
      }
      return value
    },
    maintenance: async (action, instanceId, lease) => {
      const value = await invokeManagedRuntime(options.connection, `worker.maintenance.${action}`, {
        instanceId,
        lease,
      })
      if (!value) {
        throw new Error(
          '[opencove-bootstrap:runtime_start_failed] Worker disconnected during maintenance.',
        )
      }
      return action === 'acquire' ? value.acquired === true : value.ok === true
    },
    waitStopped,
    snapshot: async operationId => {
      await assertManagedProfileStopped(options.profile)
      return await snapshotManagedProfile(options.profile, options.state, operationId)
    },
    start: async (installation, operationId) => {
      await assertManagedProfileStopped(options.profile)
      const log = await open(join(options.state, 'managed-worker.log'), 'a', 0o600)
      let child: ReturnType<typeof spawn>
      let spawnError: Error | null = null
      try {
        const executable = join(
          installation.root,
          '..',
          process.platform === 'win32' ? 'runtime/node/node.exe' : 'runtime/node/bin/node',
        )
        child = spawn(
          executable,
          [
            join(installation.root, 'out/main/worker.js'),
            '--managed-runtime',
            `--deployment-id=${options.connection.deploymentId}`,
            `--activation-id=${operationId}`,
            '--hostname=127.0.0.1',
            `--port=${options.connection.port}`,
            `--token=${options.connection.token}`,
            `--user-data=${options.profile}`,
            '--started-by=cli',
          ],
          {
            stdio: ['ignore', log.fd, log.fd],
            detached: true,
            windowsHide: true,
            env: { ...process.env, OPENCOVE_TRUST_PROCESS_ENV: '1' },
          },
        )
        child.once('error', error => {
          spawnError = error
        })
      } finally {
        await log.close()
      }
      child.unref()
      const deadline = Date.now() + 45_000
      while (true) {
        if (spawnError) {
          throw spawnError
        }
        if (child.exitCode !== null) {
          throw new Error(
            `[opencove-bootstrap:runtime_start_failed] Worker exited (${child.exitCode}); inspect the managed-worker log.`,
          )
        }
        const observed = await probeManagedRuntime(options.connection)
        if (observed) {
          return observed
        }
        if (Date.now() >= deadline) {
          throw new Error(
            '[opencove-bootstrap:runtime_start_failed] Worker readiness timed out; deployment retained for recovery.',
          )
        }
        await delay(150)
      }
    },
  }
}
