import net from 'node:net'
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

type ManagedSshRuntimeConnection = { hostname: string; port: number; token: string }

export interface ManagedSshTunnelProcess {
  exitCode: number | null
  stderr?: Pick<NodeJS.ReadableStream, 'on'> | null
  once: (event: 'exit', listener: (code: number | null) => void) => this
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
  probeConnection: (connection: ManagedSshRuntimeConnection, timeoutMs: number) => Promise<boolean>
  runBootstrap: typeof runManagedSshBootstrap
  waitForCondition: (
    fn: () => Promise<boolean>,
    timeoutMs: number,
    intervalMs?: number,
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
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  if (await fn()) {
    return true
  }
  if (Date.now() >= deadline) {
    return await fn()
  }
  await new Promise(resolve => setTimeout(resolve, intervalMs))
  return await waitForCondition(fn, Math.max(0, deadline - Date.now()), intervalMs)
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
): Promise<boolean> {
  try {
    const ping = await invokeControlSurface(
      connection,
      { kind: 'query', id: 'system.ping', payload: null },
      { timeoutMs },
    )
    return ping.httpStatus === 200 && ping.result?.ok === true
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
