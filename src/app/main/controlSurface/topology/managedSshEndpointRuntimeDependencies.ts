import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { buildAdditionalPathSegments } from '../../../../platform/os/CliEnvironment'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'
import {
  locateExecutable,
  type ExecutableLocationResult,
} from '../../../../platform/process/ExecutableLocator'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import { buildSshTunnelArgs, runManagedSshBootstrap } from './managedSshRuntimeSupport'
import type { ManagedSshEndpointRuntimeAccess } from './topologyEndpointAccess'
import {
  parseRuntimeBuildIdentity,
  hasManagedRuntimeCapabilities,
  type RuntimeBuildIdentity,
} from '../../../../shared/contracts/runtimeBuild'
import { decideManagedRuntimeUpdate } from '../../../../contexts/topology/domain/managedRuntimePolicy'

type ManagedSshRuntimeConnection = { hostname: string; port: number; token: string }

export interface ManagedSshTunnelProcess {
  exitCode: number | null
  stderr?: Pick<NodeJS.ReadableStream, 'on'> | null
  once(event: 'exit', listener: (code: number | null) => void): this
  once(event: 'error', listener: (error: Error) => void): this
  kill: (signal?: NodeJS.Signals | number) => boolean
}

export interface ManagedSshEndpointRuntimeDependencies {
  getSshAvailability: () => Promise<ExecutableLocationResult>
  reserveLoopbackPort: () => Promise<number>
  spawnTunnelProcess: (
    sshExecutablePath: string,
    access: ManagedSshEndpointRuntimeAccess,
    localPort: number,
  ) => ManagedSshTunnelProcess
  probeConnection: (
    connection: ManagedSshRuntimeConnection,
    timeoutMs: number,
    expected?: { runtimeBuild: RuntimeBuildIdentity | null; endpointId: string },
  ) => Promise<boolean>
  runBootstrap: typeof runManagedSshBootstrap
  waitForCondition: (
    fn: () => Promise<boolean>,
    timeoutMs: number,
    intervalMs?: number,
    signal?: AbortSignal,
  ) => Promise<boolean>
}

async function reserveLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to reserve a loopback port.')))
        return
      }
      server.close(error => (error ? reject(error) : resolve(address.port)))
    })
  })
}

async function waitForCondition(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 150,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    signal?.throwIfAborted()
    // A readiness probe must finish before another probe can run.
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) {
      return true
    }
    signal?.throwIfAborted()
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return false
    }
    // eslint-disable-next-line no-await-in-loop -- abortable backoff belongs to this sequential probe.
    await delay(Math.min(intervalMs, remaining), undefined, { signal })
  }
}

function spawnTunnelProcess(
  sshExecutablePath: string,
  access: ManagedSshEndpointRuntimeAccess,
  localPort: number,
): ManagedSshTunnelProcess {
  const args = buildSshTunnelArgs(access, [
    '-N',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=3',
    '-L',
    `${String(localPort)}:127.0.0.1:${String(access.ssh.remotePort)}`,
  ])
  return spawn(sshExecutablePath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  }) as ChildProcess
}

async function probeConnection(
  connection: ManagedSshRuntimeConnection,
  timeoutMs: number,
  expected?: { runtimeBuild: RuntimeBuildIdentity | null; endpointId: string },
): Promise<boolean> {
  try {
    const ping = await invokeControlSurface(
      connection,
      { kind: 'query', id: 'system.capabilities', payload: null },
      { timeoutMs },
    )
    if (ping.httpStatus !== 200 || ping.result?.ok !== true || !expected?.runtimeBuild) {
      return false
    }
    const value = ping.result.value as Record<string, unknown>
    const build = parseRuntimeBuildIdentity(value.runtimeBuild)
    if (
      !build ||
      value.deploymentId !== expected.endpointId ||
      value.runtimeReady !== true ||
      !hasManagedRuntimeCapabilities(value, build) ||
      decideManagedRuntimeUpdate(expected.runtimeBuild, build) !== 'reuse'
    ) {
      return false
    }
    const maintenance = await invokeControlSurface(
      connection,
      { kind: 'query', id: 'worker.maintenance.status', payload: null },
      { timeoutMs },
    )
    const status =
      maintenance.result?.ok === true ? (maintenance.result.value as Record<string, unknown>) : null
    return status?.phase === 'active' && status.instanceId === value.instanceId
  } catch {
    return false
  }
}

export function createDefaultManagedSshEndpointRuntimeDependencies(): ManagedSshEndpointRuntimeDependencies {
  return {
    getSshAvailability: async () =>
      await locateExecutable({
        toolId: 'ssh',
        command: 'ssh',
        fallbackDirectories: buildAdditionalPathSegments(process.platform, resolveHomeDirectory()),
      }),
    reserveLoopbackPort,
    spawnTunnelProcess,
    probeConnection,
    runBootstrap: runManagedSshBootstrap,
    waitForCondition,
  }
}
