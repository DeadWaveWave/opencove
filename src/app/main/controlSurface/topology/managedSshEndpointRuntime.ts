import type { ExecutableLocationResult } from '../../../../platform/process/ExecutableLocator'
import {
  createDefaultManagedSshEndpointRuntimeDependencies,
  type ManagedSshEndpointRuntimeDependencies,
  type ManagedSshTunnelProcess,
} from './managedSshEndpointRuntimeDependencies'
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
  accessSignature: string | null
  localPort: number | null
  process: ManagedSshTunnelProcess | null
  status: TunnelStatus
  lastError: string | null
  stderrLines: string[]
}

type InFlightTunnel = {
  accessSignature: string
  promise: Promise<ManagedTunnelRecord>
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

function managedSshAccessSignature(access: ManagedSshEndpointRuntimeAccess): string {
  return JSON.stringify([
    access.token,
    access.ssh.host,
    access.ssh.port,
    access.ssh.username,
    access.ssh.remotePort,
    access.ssh.remotePlatform,
  ])
}

export function createManagedSshEndpointRuntime(
  overrides: Partial<ManagedSshEndpointRuntimeDependencies> & { appVersion?: string | null } = {},
): ManagedSshEndpointRuntime {
  const { appVersion, ...dependencyOverrides } = overrides
  const records = new Map<string, ManagedTunnelRecord>()
  const inFlightTunnel = new Map<string, InFlightTunnel>()
  const inFlightPrepare = new Map<
    string,
    {
      accessSignature: string
      promise: Promise<{
        connection: { hostname: string; port: number; token: string } | null
        snapshot: ManagedSshRuntimeSnapshot
        bootstrapRan: boolean
      }>
    }
  >()
  let sshAvailabilityPromise: Promise<ExecutableLocationResult> | null = null
  const dependencies: ManagedSshEndpointRuntimeDependencies = {
    ...createDefaultManagedSshEndpointRuntimeDependencies(),
    ...dependencyOverrides,
  }

  const getSshAvailability = async (): Promise<ExecutableLocationResult> => {
    if (!sshAvailabilityPromise) {
      sshAvailabilityPromise = dependencies.getSshAvailability()
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
      accessSignature: null,
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
    record.accessSignature = null
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

  const ensureTunnelOnce = async (
    sshExecutablePath: string,
    access: ManagedSshEndpointRuntimeAccess,
    options?: { restartTunnel?: boolean },
  ): Promise<ManagedTunnelRecord> => {
    const record = getOrCreateRecord(access.endpointId)
    const accessSignature = managedSshAccessSignature(access)
    if (
      options?.restartTunnel ||
      (record.accessSignature !== null && record.accessSignature !== accessSignature)
    ) {
      await stopTunnel(record)
    }

    if (record.process && record.process.exitCode === null && record.localPort !== null) {
      record.status = 'ready'
      return record
    }

    record.status = 'connecting'
    record.lastError = null
    record.stderrLines = []
    record.accessSignature = accessSignature
    record.localPort = await dependencies.reserveLoopbackPort()
    const child = dependencies.spawnTunnelProcess(sshExecutablePath, access, record.localPort)
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

    const ready = await dependencies.waitForCondition(async () => {
      if (child.exitCode !== null) {
        return false
      }
      return await dependencies.probeConnection(
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


  const ensureTunnel = async (
    sshExecutablePath: string,
    access: ManagedSshEndpointRuntimeAccess,
    options?: { restartTunnel?: boolean },
  ): Promise<ManagedTunnelRecord> => {
    const accessSignature = managedSshAccessSignature(access)
    const existing = inFlightTunnel.get(access.endpointId)
    if (existing) {
      if (existing.accessSignature === accessSignature && !options?.restartTunnel) {
        return await existing.promise
      }
      await existing.promise.catch(() => undefined)
      return await ensureTunnel(sshExecutablePath, access, options)
    }

    const promise = ensureTunnelOnce(sshExecutablePath, access, options)
    inFlightTunnel.set(access.endpointId, { accessSignature, promise })
    try {
      return await promise
    } finally {
      if (inFlightTunnel.get(access.endpointId)?.promise === promise) {
        inFlightTunnel.delete(access.endpointId)
      }
    }
  }

  const runBootstrap = async (
    sshExecutablePath: string,
    access: ManagedSshEndpointRuntimeAccess,
    options?: { reinstallRuntime?: boolean; appVersion?: string | null },
  ): Promise<void> => {
    await dependencies.runBootstrap(sshExecutablePath, access, options)
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
    const accessSignature = managedSshAccessSignature(access)
    const existing = inFlightPrepare.get(access.endpointId)
    if (existing) {
      if (existing.accessSignature === accessSignature) {
        return await existing.promise
      }
      await existing.promise.catch(() => undefined)
      return await prepare(access, options)
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

      const ready =
        connection !== null ? await dependencies.probeConnection(connection, 750) : false
      if (!ready && options?.allowBootstrap !== false) {
        try {
          await runBootstrap(sshAvailability.executablePath, access, {
            reinstallRuntime: options?.reinstallRuntime,
            appVersion,
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

    inFlightPrepare.set(access.endpointId, { accessSignature, promise: run })
    try {
      return await run
    } finally {
      if (inFlightPrepare.get(access.endpointId)?.promise === run) {
        inFlightPrepare.delete(access.endpointId)
      }
    }
  }

  const disposeEndpoint: ManagedSshEndpointRuntimeDisposer = async access => {
    await inFlightPrepare.get(access.endpointId)?.promise.catch(() => undefined)
    await inFlightTunnel.get(access.endpointId)?.promise.catch(() => undefined)
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
