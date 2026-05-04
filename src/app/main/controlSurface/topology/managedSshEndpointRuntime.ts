import net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { buildAdditionalPathSegments } from '../../../../platform/os/CliEnvironment'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'
import {
  locateExecutable,
  type ExecutableLocationResult,
} from '../../../../platform/process/ExecutableLocator'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import { buildSshArgs, runManagedSshBootstrap } from './managedSshRuntimeSupport'
import type {
  ManagedSshEndpointConnectionResolver,
  ManagedSshEndpointRuntimeDisposer,
  ManagedSshEndpointRuntimeAccess,
} from './topologyEndpointAccess'

type TunnelStatus = 'idle' | 'connecting' | 'ready' | 'error'

export interface ManagedSshRuntimeSnapshot {
  endpointId: string
  status: TunnelStatus
  localPort: number | null
  lastError: string | null
  stderrTail: string
}

type ManagedTunnelRecord = {
  endpointId: string
  localPort: number | null
  process: ChildProcess | null
  status: TunnelStatus
  lastError: string | null
  stderrLines: string[]
}

export interface ManagedSshEndpointRuntime
  extends
    Pick<ManagedSshEndpointConnectionResolver, never>,
    Pick<ManagedSshEndpointRuntimeDisposer, never> {
  resolveConnection: ManagedSshEndpointConnectionResolver
  disposeEndpoint: ManagedSshEndpointRuntimeDisposer
  prepare: (
    access: ManagedSshEndpointRuntimeAccess,
    options?: {
      restartTunnel?: boolean
      reinstallRuntime?: boolean
      allowBootstrap?: boolean
    },
  ) => Promise<{
    connection: { hostname: string; port: number; token: string } | null
    snapshot: ManagedSshRuntimeSnapshot
    bootstrapRan: boolean
  }>
  getSnapshot: (endpointId: string) => ManagedSshRuntimeSnapshot | null
  getSshAvailability: () => Promise<ExecutableLocationResult>
  dispose: () => Promise<void>
}

function trimStderrLines(lines: string[]): string[] {
  return lines.slice(Math.max(0, lines.length - 12))
}

function toSnapshot(record: ManagedTunnelRecord): ManagedSshRuntimeSnapshot {
  return {
    endpointId: record.endpointId,
    status: record.status,
    localPort: record.localPort,
    lastError: record.lastError,
    stderrTail: trimStderrLines(record.stderrLines).join(''),
  }
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

      server.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

async function waitForCondition(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const poll = async (): Promise<boolean> => {
    if (await fn()) {
      return true
    }

    if (Date.now() >= deadline) {
      return await fn()
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
    return await poll()
  }

  return await poll()
}

export function createManagedSshEndpointRuntime(): ManagedSshEndpointRuntime {
  const records = new Map<string, ManagedTunnelRecord>()
  const inFlightPrepare = new Map<
    string,
    Promise<{
      connection: { hostname: string; port: number; token: string } | null
      snapshot: ManagedSshRuntimeSnapshot
      bootstrapRan: boolean
    }>
  >()
  let sshAvailabilityPromise: Promise<ExecutableLocationResult> | null = null

  const getSshAvailability = async (): Promise<ExecutableLocationResult> => {
    if (!sshAvailabilityPromise) {
      sshAvailabilityPromise = locateExecutable({
        toolId: 'ssh',
        command: 'ssh',
        fallbackDirectories: buildAdditionalPathSegments(process.platform, resolveHomeDirectory()),
      })
    }

    return await sshAvailabilityPromise
  }

  const getOrCreateRecord = (endpointId: string): ManagedTunnelRecord => {
    const existing = records.get(endpointId)
    if (existing) {
      return existing
    }

    const next: ManagedTunnelRecord = {
      endpointId,
      localPort: null,
      process: null,
      status: 'idle',
      lastError: null,
      stderrLines: [],
    }
    records.set(endpointId, next)
    return next
  }

  const stopTunnel = async (record: ManagedTunnelRecord): Promise<void> => {
    const child = record.process
    record.process = null
    record.localPort = null
    record.status = 'idle'
    if (!child || child.exitCode !== null) {
      return
    }

    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, 2_500)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
      try {
        child.kill('SIGTERM')
      } catch {
        clearTimeout(timeout)
        resolve()
      }
    })
  }

  const probeConnection = async (
    connection: { hostname: string; port: number; token: string },
    timeoutMs: number,
  ): Promise<boolean> => {
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

  const ensureTunnel = async (
    sshExecutablePath: string,
    access: ManagedSshEndpointRuntimeAccess,
    options?: { restartTunnel?: boolean },
  ): Promise<ManagedTunnelRecord> => {
    const record = getOrCreateRecord(access.endpointId)
    if (options?.restartTunnel) {
      await stopTunnel(record)
    }

    if (record.process && record.process.exitCode === null && record.localPort !== null) {
      record.status = 'ready'
      return record
    }

    record.status = 'connecting'
    record.lastError = null
    record.stderrLines = []
    record.localPort = await reserveLoopbackPort()
    const args = [
      ...buildSshArgs(access, [
        '-N',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=3',
        '-L',
        `${String(record.localPort)}:127.0.0.1:${String(access.ssh.remotePort)}`,
      ]),
    ]

    const child = spawn(sshExecutablePath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    record.process = child
    child.stderr?.on('data', chunk => {
      record.stderrLines.push(chunk.toString())
      record.stderrLines = trimStderrLines(record.stderrLines)
    })
    child.once('exit', code => {
      if (record.process !== child) {
        return
      }

      record.process = null
      if (record.status === 'connecting' || record.status === 'ready') {
        record.status = 'error'
        record.lastError =
          record.stderrLines.join('').trim() || `ssh tunnel exited with code ${String(code ?? 1)}`
      }
      record.localPort = null
    })

    const ready = await waitForCondition(async () => {
      if (child.exitCode !== null) {
        return false
      }
      return await probeConnection(
        {
          hostname: '127.0.0.1',
          port: record.localPort ?? 0,
          token: access.token,
        },
        500,
      )
    }, 7_500)

    if (!ready) {
      record.status = 'error'
      record.lastError =
        record.stderrLines.join('').trim() ||
        'SSH tunnel started, but the remote worker is not ready yet.'
      return record
    }

    record.status = 'ready'
    return record
  }

  const runBootstrap = async (
    sshExecutablePath: string,
    access: ManagedSshEndpointRuntimeAccess,
    options?: { reinstallRuntime?: boolean },
  ): Promise<void> => {
    await runManagedSshBootstrap(sshExecutablePath, access, options)
  }

  const resolveConnection: ManagedSshEndpointConnectionResolver = async access => {
    const sshAvailability = await getSshAvailability()
    if (!sshAvailability.executablePath) {
      return null
    }

    const record = await ensureTunnel(sshAvailability.executablePath, access)
    if (record.status !== 'ready' || record.localPort === null) {
      return null
    }

    return {
      hostname: '127.0.0.1',
      port: record.localPort,
      token: access.token,
    }
  }

  const prepare: ManagedSshEndpointRuntime['prepare'] = async (access, options) => {
    const existing = inFlightPrepare.get(access.endpointId)
    if (existing) {
      return await existing
    }

    const run = (async () => {
      const sshAvailability = await getSshAvailability()
      if (!sshAvailability.executablePath) {
        const record = getOrCreateRecord(access.endpointId)
        record.status = 'error'
        record.lastError = sshAvailability.diagnostics.join(' ')
        return {
          connection: null,
          snapshot: toSnapshot(record),
          bootstrapRan: false,
        }
      }

      let record = await ensureTunnel(sshAvailability.executablePath, access, {
        restartTunnel: options?.restartTunnel,
      })
      let connection =
        record.status === 'ready' && record.localPort !== null
          ? { hostname: '127.0.0.1', port: record.localPort, token: access.token }
          : null
      let bootstrapRan = false

      const ready = connection !== null ? await probeConnection(connection, 750) : false
      if (!ready && options?.allowBootstrap !== false) {
        try {
          await runBootstrap(sshAvailability.executablePath, access, {
            reinstallRuntime: options?.reinstallRuntime,
          })
          bootstrapRan = true
          record = await ensureTunnel(sshAvailability.executablePath, access, {
            restartTunnel: true,
          })
          connection =
            record.status === 'ready' && record.localPort !== null
              ? { hostname: '127.0.0.1', port: record.localPort, token: access.token }
              : null
        } catch (error) {
          record.status = 'error'
          record.lastError = error instanceof Error ? error.message : String(error)
        }
      }

      return {
        connection,
        snapshot: toSnapshot(record),
        bootstrapRan,
      }
    })()

    inFlightPrepare.set(access.endpointId, run)
    try {
      return await run
    } finally {
      inFlightPrepare.delete(access.endpointId)
    }
  }

  const disposeEndpoint: ManagedSshEndpointRuntimeDisposer = async access => {
    const record = records.get(access.endpointId)
    if (!record) {
      return
    }

    records.delete(access.endpointId)
    await stopTunnel(record)
  }

  return {
    resolveConnection,
    disposeEndpoint,
    prepare,
    getSnapshot: endpointId => {
      const record = records.get(endpointId)
      return record ? toSnapshot(record) : null
    },
    getSshAvailability,
    dispose: async () => {
      await Promise.all(
        [...records.values()].map(async record => {
          records.delete(record.endpointId)
          await stopTunnel(record)
        }),
      )
    },
  }
}