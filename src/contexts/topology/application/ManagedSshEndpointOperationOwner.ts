import type {
  ManagedSshEndpointOperationDto,
  ManagedSshEndpointOperationKind,
  ManagedSshEndpointOperationPhase,
} from '../../../shared/contracts/dto'
import { createAppError } from '../../../shared/errors/appError'
import type {
  ManagedSshEndpointPreparationAccess,
  ManagedSshEndpointPreparationFailureKind,
  ManagedSshEndpointPreparationPort,
  ManagedSshEndpointPreparationResult,
} from './ports/ManagedSshEndpointPreparationPort'

const PHASE_ORDER = [
  'checking_prerequisites',
  'checking_existing_connection',
  'detecting_platform',
  'checking_remote_runtime',
  'checking_installation',
  'downloading_installer',
  'installing_runtime',
  'starting_runtime',
  'waiting_for_runtime',
  'opening_tunnel',
  'verifying_connection',
] as const satisfies readonly ManagedSshEndpointOperationPhase[]

const PHASE_INDEX = new Map<ManagedSshEndpointOperationPhase, number>(
  PHASE_ORDER.map((phase, index) => [phase, index]),
)

export interface ManagedSshEndpointOperationIntent {
  kind: ManagedSshEndpointOperationKind
  access: ManagedSshEndpointPreparationAccess
  restartTunnel: boolean
  reinstallRuntime: boolean
}

type ManagedSshOperationEventBase = ManagedSshEndpointOperationDto & {
  endpointId: string
  elapsedMs: number
}

export type ManagedSshOperationLifecycleEvent =
  | (ManagedSshOperationEventBase & { type: 'started' | 'phase' | 'succeeded' | 'cancelled' })
  | (ManagedSshOperationEventBase & {
      type: 'failed'
      failureKind: ManagedSshEndpointPreparationFailureKind
    })

type OperationRecord = {
  endpointId: string
  signature: string
  snapshot: ManagedSshEndpointOperationDto
  startedAtMs: number
  controller: AbortController
  settlement: Promise<void>
}

function operationSignature(intent: ManagedSshEndpointOperationIntent): string {
  return JSON.stringify([
    intent.kind,
    intent.restartTunnel,
    intent.reinstallRuntime,
    intent.access.endpointId,
    intent.access.token,
    intent.access.ssh.host,
    intent.access.ssh.port,
    intent.access.ssh.username,
    intent.access.ssh.remotePort,
    intent.access.ssh.remotePlatform,
  ])
}

function cloneSnapshot(snapshot: ManagedSshEndpointOperationDto): ManagedSshEndpointOperationDto {
  return { ...snapshot }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export class ManagedSshEndpointOperationOwner {
  private readonly records = new Map<string, OperationRecord>()
  private readonly retiring = new Map<string, Promise<void>>()
  private readonly admissionEpochs = new Map<string, symbol>()
  private readonly mutations = new Set<string>()
  private disposed = false
  private disposal: Promise<void> | null = null

  public constructor(
    private readonly options: {
      preparationPort: ManagedSshEndpointPreparationPort
      createOperationId: () => string
      now: () => number
      diagnosticSink?: (event: ManagedSshOperationLifecycleEvent) => void
    },
  ) {}

  public start(intent: ManagedSshEndpointOperationIntent): ManagedSshEndpointOperationDto {
    if (this.disposed) {
      throw createAppError('common.unavailable', {
        debugMessage: 'Managed SSH operation owner is disposed.',
      })
    }

    if (
      this.retiring.has(intent.access.endpointId) ||
      this.mutations.has(intent.access.endpointId)
    ) {
      throw createAppError('endpoint.operation_in_progress')
    }
    intent = { ...intent, access: { ...intent.access, ssh: { ...intent.access.ssh } } }
    const signature = operationSignature(intent)
    const existing = this.records.get(intent.access.endpointId)
    if (existing) {
      if (existing.signature === signature) {
        return cloneSnapshot(existing.snapshot)
      }

      throw createAppError('endpoint.operation_in_progress', {
        debugMessage: `A Managed SSH operation is already active for endpoint ${intent.access.endpointId}.`,
      })
    }

    const startedAtMs = this.options.now()
    const timestamp = new Date(startedAtMs).toISOString()
    const operationId = this.options.createOperationId()
    if (operationId.trim().length === 0) {
      throw createAppError('common.unexpected', {
        debugMessage: 'Managed SSH operation ID factory returned an empty value.',
      })
    }

    const record: OperationRecord = {
      endpointId: intent.access.endpointId,
      signature,
      startedAtMs,
      snapshot: {
        operationId,
        revision: 1,
        kind: intent.kind,
        phase: 'checking_prerequisites',
        startedAt: timestamp,
        updatedAt: timestamp,
      },
      controller: new AbortController(),
      settlement: Promise.resolve(),
    }
    this.records.set(record.endpointId, record)
    this.emit(record, 'started')

    record.settlement = Promise.resolve().then(async () => {
      const result = await this.execute(record, intent)
      this.settle(record, result)
    })

    return cloneSnapshot(record.snapshot)
  }

  public getSnapshot(endpointId: string): ManagedSshEndpointOperationDto | null {
    const record = this.records.get(endpointId)
    return record ? cloneSnapshot(record.snapshot) : null
  }

  public hasActiveOperation(endpointId: string): boolean {
    return (
      this.records.has(endpointId) ||
      this.retiring.has(endpointId) ||
      this.mutations.has(endpointId)
    )
  }

  public captureAdmission(endpointId: string): () => void {
    const epoch = this.admissionEpochs.get(endpointId)
    const assertCurrent = (): void => {
      if (this.disposed) {
        throw createAppError('common.unavailable')
      }
      if (epoch !== this.admissionEpochs.get(endpointId) || this.mutations.has(endpointId)) {
        throw createAppError('endpoint.operation_in_progress')
      }
    }
    assertCurrent()
    return assertCurrent
  }

  public async withEndpointMutation<T>(endpointId: string, mutate: () => Promise<T>): Promise<T> {
    this.captureAdmission(endpointId)()
    this.admissionEpochs.set(endpointId, Symbol('topology-mutation'))
    this.mutations.add(endpointId)
    try {
      // The topology owner validates first, then calls disposeEndpoint before committing.
      return await mutate()
    } finally {
      this.mutations.delete(endpointId)
    }
  }

  public async disposeEndpoint(endpointId: string): Promise<void> {
    const record = this.records.get(endpointId)
    if (!record) {
      return await this.retiring.get(endpointId)
    }
    this.cancel(record)
    await this.retiring.get(endpointId)
  }

  public dispose(): Promise<void> {
    if (!this.disposal) {
      this.disposed = true
      ;[...this.records.values()].forEach(record => this.cancel(record))
      this.disposal = Promise.all([...this.retiring.values()]).then(() => undefined)
    }
    return this.disposal
  }

  private async execute(
    record: OperationRecord,
    intent: ManagedSshEndpointOperationIntent,
  ): Promise<ManagedSshEndpointPreparationResult> {
    try {
      if (record.controller.signal.aborted || this.records.get(record.endpointId) !== record) {
        return { status: 'cancelled' }
      }
      return await this.options.preparationPort.execute({
        operationId: record.snapshot.operationId,
        access: intent.access,
        restartTunnel: intent.restartTunnel,
        reinstallRuntime: intent.reinstallRuntime,
        signal: record.controller.signal,
        reportPhase: phase => this.advance(record, phase),
      })
    } catch (error) {
      if (isAbortError(error) || record.controller.signal.aborted) {
        return { status: 'cancelled' }
      }
      return { status: 'failed', failureKind: 'unknown' }
    }
  }

  private advance(record: OperationRecord, phase: ManagedSshEndpointOperationPhase): void {
    if (this.records.get(record.endpointId) !== record || record.controller.signal.aborted) {
      return
    }

    const currentIndex = PHASE_INDEX.get(record.snapshot.phase)
    const nextIndex = PHASE_INDEX.get(phase)
    if (currentIndex === undefined || nextIndex === undefined || nextIndex <= currentIndex) {
      return
    }

    const updatedAtMs = this.options.now()
    record.snapshot = {
      ...record.snapshot,
      revision: record.snapshot.revision + 1,
      phase,
      updatedAt: new Date(updatedAtMs).toISOString(),
    }
    this.emit(record, 'phase', updatedAtMs)
  }

  private settle(record: OperationRecord, result: ManagedSshEndpointPreparationResult): void {
    if (this.records.get(record.endpointId) !== record) {
      return
    }

    this.records.delete(record.endpointId)
    if (result.status === 'ready') {
      this.emit(record, 'succeeded')
      return
    }
    if (result.status === 'failed') {
      this.emit(record, 'failed', undefined, result.failureKind)
      return
    }
    this.emit(record, 'cancelled')
  }

  private cancel(record: OperationRecord): void {
    if (this.records.get(record.endpointId) !== record) {
      return
    }

    this.records.delete(record.endpointId)
    const retirement = record.settlement.finally(() => {
      if (this.retiring.get(record.endpointId) === retirement) {
        this.retiring.delete(record.endpointId)
      }
    })
    this.retiring.set(record.endpointId, retirement)
    record.controller.abort()
    this.emit(record, 'cancelled')
  }

  private emit(
    record: OperationRecord,
    type: ManagedSshOperationLifecycleEvent['type'],
    now = this.options.now(),
    failureKind?: ManagedSshEndpointPreparationFailureKind,
  ): void {
    try {
      const base: ManagedSshOperationEventBase = {
        endpointId: record.endpointId,
        ...cloneSnapshot(record.snapshot),
        elapsedMs: Math.max(0, now - record.startedAtMs),
      }
      if (type === 'failed') {
        this.options.diagnosticSink?.({
          ...base,
          type,
          failureKind: failureKind ?? 'unknown',
        })
        return
      }
      this.options.diagnosticSink?.({ ...base, type })
    } catch {
      // Diagnostics cannot own operation execution.
    }
  }
}
