import type { ExecutableLocationResult } from '../../../../platform/process/ExecutableLocator'
import { createCommandOutputCapture } from '../../../../platform/process/boundedCommandOutput'
import type {
  ManagedSshEndpointPreparationPort,
  ManagedSshEndpointPreparationRequest,
  ManagedSshEndpointPreparationResult,
  ManagedSshEndpointPreparationFailureKind,
} from '../../../../contexts/topology/application/ports/ManagedSshEndpointPreparationPort'
import {
  createDefaultManagedSshEndpointRuntimeDependencies,
  type ManagedSshEndpointRuntimeDependencies,
  type ManagedSshTunnelProcess,
} from './managedSshEndpointRuntimeDependencies'
import { ManagedSshBootstrapError } from './managedSshRuntimeSupport'
import type {
  ManagedSshEndpointConnectionResolver,
  ManagedSshEndpointRuntimeDisposer,
  ManagedSshEndpointRuntimeAccess,
  RemoteEndpointConnection,
} from './topologyEndpointAccess'

export interface ManagedSshRuntimeSnapshot {
  endpointId: string
  status: 'idle' | 'connecting' | 'ready' | 'error'
  localPort: number | null
  lastError: string | null
  stderrTail: string
  failureKind: ManagedSshEndpointPreparationFailureKind | null
}

type ResourceRecord = {
  access: ManagedSshEndpointRuntimeAccess
  signature: string
  process: ManagedSshTunnelProcess | null
  snapshot: ManagedSshRuntimeSnapshot
  execution: Execution | null
  stopping: Promise<void> | null
}

type Execution = {
  id: string | symbol
  controller: AbortController
  settlement: Promise<ManagedSshEndpointPreparationResult>
}

export interface ManagedSshEndpointRuntime extends ManagedSshEndpointPreparationPort {
  resolveConnection: ManagedSshEndpointConnectionResolver
  disposeEndpoint: ManagedSshEndpointRuntimeDisposer
  getSnapshot: (endpointId: string) => ManagedSshRuntimeSnapshot | null
  getSshAvailability: () => Promise<ExecutableLocationResult>
  dispose: () => Promise<void>
}

function accessSignature(access: ManagedSshEndpointRuntimeAccess): string {
  return JSON.stringify([
    access.token,
    access.ssh.host,
    access.ssh.port,
    access.ssh.username,
    access.ssh.remotePort,
    access.ssh.remotePlatform,
  ])
}

function abortError(): Error {
  return Object.assign(new Error('Managed SSH execution retired.'), { name: 'AbortError' })
}

export function createManagedSshEndpointRuntime(
  overrides: Partial<ManagedSshEndpointRuntimeDependencies> & { appVersion?: string | null } = {},
): ManagedSshEndpointRuntime {
  const { appVersion, ...dependencyOverrides } = overrides
  const dependencies = {
    ...createDefaultManagedSshEndpointRuntimeDependencies(),
    ...dependencyOverrides,
  }
  const records = new Map<string, ResourceRecord>()
  const retiring = new Map<string, Promise<void>>()
  let disposed = false
  let disposal: Promise<void> | null = null
  let sshAvailability: Promise<ExecutableLocationResult> | null = null
  const getSshAvailability = (): Promise<ExecutableLocationResult> =>
    (sshAvailability ??= dependencies.getSshAvailability())

  const connectionOf = (record: ResourceRecord): RemoteEndpointConnection | null =>
    record.snapshot.status === 'ready' &&
    record.snapshot.localPort !== null &&
    record.process?.exitCode === null
      ? { hostname: '127.0.0.1', port: record.snapshot.localPort, token: record.access.token }
      : null

  const checkCurrent = (record: ResourceRecord, execution: Execution): void => {
    if (
      disposed ||
      records.get(record.access.endpointId) !== record ||
      record.execution !== execution ||
      execution.controller.signal.aborted
    ) {
      throw abortError()
    }
  }

  const stopTunnel = (record: ResourceRecord): Promise<void> => {
    if (record.stopping) {
      return record.stopping
    }
    const child = record.process
    record.process = null
    record.snapshot.localPort = null
    if (!child || child.exitCode !== null) {
      return Promise.resolve()
    }
    const stopped = new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* The child may already have exited. */
        }
      }, 2_500)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      try {
        child.kill('SIGTERM')
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
    record.stopping = stopped.finally(() => {
      record.stopping = null
    })
    return record.stopping
  }

  const openTunnel = async (
    record: ResourceRecord,
    execution: Execution,
    sshPath: string,
    reportPhase: ManagedSshEndpointPreparationRequest['reportPhase'],
  ): Promise<void> => {
    checkCurrent(record, execution)
    reportPhase('opening_tunnel')
    const port = await dependencies.reserveLoopbackPort()
    checkCurrent(record, execution)
    const child = dependencies.spawnTunnelProcess(sshPath, record.access, port)
    record.process = child
    record.snapshot.localPort = port
    const output = createCommandOutputCapture(262_144)
    child.stderr?.on('data', chunk => {
      if (records.get(record.access.endpointId) !== record || record.process !== child) {
        return
      }
      output.append(chunk)
      record.snapshot.stderrTail = output.value()
    })
    const failed = (detail: string): void => {
      if (records.get(record.access.endpointId) !== record || record.process !== child) {
        return
      }
      record.snapshot.status = 'error'
      record.snapshot.lastError = record.snapshot.stderrTail.trim() || detail
      record.snapshot.failureKind = 'tunnel_failed'
    }
    child.once('error', error => failed(error.message))
    child.once('exit', code => {
      failed(`SSH tunnel exited with code ${String(code ?? 1)}.`)
      if (record.process === child) {
        record.process = null
        record.snapshot.localPort = null
      }
    })
    reportPhase('verifying_connection')
    const ready = await dependencies.waitForCondition(
      async () => {
        checkCurrent(record, execution)
        if (
          record.process !== child ||
          child.exitCode !== null ||
          record.snapshot.status === 'error'
        ) {
          throw new ManagedSshBootstrapError(
            'unknown',
            record.snapshot.lastError ?? 'SSH tunnel exited.',
          )
        }
        const reachable = await dependencies.probeConnection(
          { hostname: '127.0.0.1', port, token: record.access.token },
          500,
        )
        checkCurrent(record, execution)
        return reachable
      },
      7_500,
      150,
      execution.controller.signal,
    )
    checkCurrent(record, execution)
    if (
      !ready ||
      record.process !== child ||
      child.exitCode !== null ||
      record.snapshot.status === 'error'
    ) {
      record.snapshot.failureKind = 'tunnel_failed'
      throw new Error(
        record.snapshot.lastError ?? 'The remote Worker could not be reached through SSH.',
      )
    }
    record.snapshot.status = 'ready'
  }

  const run = async (
    record: ResourceRecord,
    execution: Execution,
    request?: ManagedSshEndpointPreparationRequest,
  ): Promise<ManagedSshEndpointPreparationResult> => {
    const reportPhase: ManagedSshEndpointPreparationRequest['reportPhase'] = phase => {
      checkCurrent(record, execution)
      request?.reportPhase(phase)
    }
    try {
      checkCurrent(record, execution)
      reportPhase('checking_prerequisites')
      const ssh = await getSshAvailability()
      checkCurrent(record, execution)
      if (!ssh.executablePath) {
        record.snapshot.failureKind = 'tunnel_failed'
        throw new Error(ssh.diagnostics.join(' ') || 'SSH is not installed.')
      }
      if (record.process && !request?.restartTunnel && !request?.reinstallRuntime) {
        reportPhase('checking_existing_connection')
        const port = record.snapshot.localPort
        const ready =
          port !== null &&
          (await dependencies.probeConnection(
            {
              hostname: '127.0.0.1',
              port,
              token: record.access.token,
            },
            750,
          ))
        checkCurrent(record, execution)
        if (ready && record.process?.exitCode === null) {
          record.snapshot.status = 'ready'
          return { status: 'ready' }
        }
      }
      await stopTunnel(record)
      checkCurrent(record, execution)
      record.snapshot.status = 'connecting'
      record.snapshot.lastError = null
      record.snapshot.stderrTail = ''
      record.snapshot.failureKind = null
      if (request) {
        await dependencies.runBootstrap(ssh.executablePath, record.access, {
          reinstallRuntime: request.reinstallRuntime,
          appVersion,
          signal: execution.controller.signal,
          reportPhase,
        })
        checkCurrent(record, execution)
      }
      await openTunnel(record, execution, ssh.executablePath, reportPhase)
      return { status: 'ready' }
    } catch (error) {
      if (
        execution.controller.signal.aborted ||
        records.get(record.access.endpointId) !== record ||
        disposed
      ) {
        await stopTunnel(record)
        return { status: 'cancelled' }
      }
      record.snapshot.status = 'error'
      record.snapshot.lastError = error instanceof Error ? error.message : String(error)
      record.snapshot.failureKind ??=
        error instanceof ManagedSshBootstrapError ? error.failureKind : 'unknown'
      await stopTunnel(record)
      return { status: 'failed', failureKind: record.snapshot.failureKind }
    }
  }

  const startExecution = (
    access: ManagedSshEndpointRuntimeAccess,
    request?: ManagedSshEndpointPreparationRequest,
  ): Promise<ManagedSshEndpointPreparationResult> => {
    if (disposed || request?.signal.aborted || retiring.has(access.endpointId)) {
      return Promise.resolve({ status: 'cancelled' })
    }
    let record = records.get(access.endpointId)
    if (!record) {
      record = {
        access: { ...access, ssh: { ...access.ssh } },
        signature: accessSignature(access),
        process: null,
        execution: null,
        stopping: null,
        snapshot: {
          endpointId: access.endpointId,
          status: 'idle',
          localPort: null,
          lastError: null,
          stderrTail: '',
          failureKind: null,
        },
      }
      records.set(access.endpointId, record)
    }
    const currentRecord = record
    // Application admission owns intent deduplication. A pre-existing resolver only owns I/O;
    // retire it before the accepted preparation starts using this resource record.
    const previousExecution = record.execution
    previousExecution?.controller.abort()
    const execution: Execution = {
      id: request?.operationId ?? Symbol('resolve'),
      controller: new AbortController(),
      settlement: Promise.resolve({ status: 'cancelled' }),
    }
    record.execution = execution
    record.snapshot.status = 'connecting'
    const abort = (): void => {
      execution.controller.abort()
    }
    request?.signal.addEventListener('abort', abort, { once: true })
    execution.settlement = (async () => {
      await previousExecution?.settlement
      checkCurrent(currentRecord, execution)
      if (currentRecord.signature !== accessSignature(access)) {
        await stopTunnel(currentRecord)
        checkCurrent(currentRecord, execution)
        currentRecord.access = { ...access, ssh: { ...access.ssh } }
        currentRecord.signature = accessSignature(access)
      }
      return await run(currentRecord, execution, request)
    })()
      .catch(async error => {
        await stopTunnel(currentRecord)
        if (
          execution.controller.signal.aborted ||
          disposed ||
          records.get(access.endpointId) !== currentRecord
        ) {
          return { status: 'cancelled' } as const
        }
        currentRecord.snapshot.status = 'error'
        currentRecord.snapshot.lastError = error instanceof Error ? error.message : String(error)
        currentRecord.snapshot.failureKind = 'unknown'
        return { status: 'failed', failureKind: 'unknown' } as const
      })
      .finally(() => {
        request?.signal.removeEventListener('abort', abort)
        if (currentRecord.execution === execution) {
          currentRecord.execution = null
        }
      })
    return execution.settlement
  }

  const retire = (endpointId: string): Promise<void> => {
    const pending = retiring.get(endpointId)
    if (pending) {
      return pending
    }
    const record = records.get(endpointId)
    if (!record) {
      return Promise.resolve()
    }
    records.delete(endpointId)
    record.execution?.controller.abort()
    const result = Promise.all([stopTunnel(record), record.execution?.settlement]).then(
      () => undefined,
    )
    retiring.set(endpointId, result)
    void result.finally(() => {
      if (retiring.get(endpointId) === result) {
        retiring.delete(endpointId)
      }
    })
    return result
  }

  return {
    execute: request => startExecution(request.access, request),
    resolveConnection: async access => {
      if (disposed || retiring.has(access.endpointId)) {
        return null
      }
      const record = records.get(access.endpointId)
      if (record?.execution) {
        if (
          typeof record.execution.id === 'string' ||
          record.signature !== accessSignature(access)
        ) {
          return null
        }
        await record.execution.settlement
      } else if (record?.signature !== accessSignature(access) || !connectionOf(record)) {
        await startExecution(access)
      }
      const current = records.get(access.endpointId)
      return current && !current.execution && current.signature === accessSignature(access)
        ? connectionOf(current)
        : null
    },
    disposeEndpoint: access => retire(access.endpointId),
    getSnapshot: endpointId => {
      const record = records.get(endpointId)
      return record ? { ...record.snapshot } : null
    },
    getSshAvailability,
    dispose: () => {
      if (!disposal) {
        disposed = true
        disposal = Promise.all([...records.keys()].map(retire).concat([...retiring.values()])).then(
          () => undefined,
        )
      }
      return disposal
    },
  }
}
