import type {
  PrepareWorkerEndpointInput,
  RepairWorkerEndpointInput,
  WorkerEndpointOverviewDto,
} from '@shared/contracts/dto'
import { createAppError } from '@shared/errors/appError'
import type { EndpointOverviewControlPort } from '../../application/ports/EndpointOverviewControlPort'

type CommandKind = 'prepare' | 'repair'
export interface EndpointOverviewProjection {
  overviews: WorkerEndpointOverviewDto[]
  isLoading: boolean
  observationRevision: number
  error: string | null
  busyByEndpointId: Readonly<Record<string, CommandKind>>
}

/** Renderer-local observation only. Worker operations survive the last consumer leaving. */
export class EndpointOverviewProjectionOwner {
  private snapshot: EndpointOverviewProjection = {
    overviews: [],
    isLoading: false,
    observationRevision: 0,
    error: null,
    busyByEndpointId: {},
  }
  private readonly listeners = new Set<() => void>()
  private readonly pendingCommands = new Map<string, CommandKind>()
  private consumers = 0
  private observationEpoch = 0
  private commandEpoch = 0
  private topologyEpoch = 0
  private inFlight: Promise<WorkerEndpointOverviewDto[] | null> | null = null
  private queryRequested = false
  private cancelTimer: (() => void) | null = null
  private disposed = false

  public constructor(
    private readonly options: {
      port: EndpointOverviewControlPort
      schedule: (callback: () => void, delayMs: number) => () => void
      formatError: (error: unknown) => string
    },
  ) {}

  public getSnapshot = (): EndpointOverviewProjection => this.snapshot

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public acquire(): () => void {
    if (this.disposed) {
      throw createAppError('common.unavailable')
    }
    this.consumers += 1
    if (this.consumers === 1) {
      this.observationEpoch += 1
      void this.reload()
    }
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.consumers -= 1
      if (this.consumers === 0) {
        this.observationEpoch += 1
        this.queryRequested = false
        this.stopTimer()
      }
    }
  }

  public topologyChanged = (): void => {
    this.topologyEpoch += 1
    this.commandEpoch += 1
    this.refreshIfObserved()
  }

  public refreshIfObserved = (): void => {
    if (this.consumers > 0) {
      void this.reload()
    }
  }

  public reload = (): Promise<WorkerEndpointOverviewDto[] | null> => {
    if (this.disposed) {
      return Promise.resolve(null)
    }
    this.stopTimer()
    this.queryRequested = true
    if (!this.inFlight) {
      this.inFlight = this.drainQueries().finally(() => {
        this.inFlight = null
        this.schedulePoll()
      })
    }
    return this.inFlight
  }

  public prepareEndpoint = (
    input: PrepareWorkerEndpointInput,
  ): Promise<WorkerEndpointOverviewDto> =>
    this.runCommand(input.endpointId, 'prepare', async () => await this.options.port.prepare(input))

  public repairEndpoint = (input: RepairWorkerEndpointInput): Promise<WorkerEndpointOverviewDto> =>
    this.runCommand(input.endpointId, 'repair', async () => await this.options.port.repair(input))

  public dispose(): void {
    this.disposed = true
    this.observationEpoch += 1
    this.queryRequested = false
    this.stopTimer()
    this.listeners.clear()
  }

  private async drainQueries(): Promise<WorkerEndpointOverviewDto[] | null> {
    let result: WorkerEndpointOverviewDto[] | null = null
    while (this.queryRequested && !this.disposed) {
      this.queryRequested = false
      const observationEpoch = this.observationEpoch
      const commandEpoch = this.commandEpoch
      const current = () =>
        !this.disposed &&
        this.pendingCommands.size === 0 &&
        observationEpoch === this.observationEpoch &&
        commandEpoch === this.commandEpoch
      this.publish({ isLoading: this.snapshot.overviews.length === 0 })
      try {
        // eslint-disable-next-line no-await-in-loop -- this owner guarantees one observation stream.
        const overviews = await this.options.port.list()
        if (current()) {
          result = overviews.map(overview => this.forwardOverview(overview))
          this.publish({
            overviews: result,
            error: null,
            observationRevision: this.snapshot.observationRevision + 1,
          })
        }
      } catch (error) {
        if (current()) {
          this.publish({ error: this.options.formatError(error) })
        }
      } finally {
        if (!this.disposed) {
          this.publish({ isLoading: false })
        }
      }
    }
    return result
  }

  private async runCommand(
    endpointId: string,
    kind: CommandKind,
    invoke: () => Promise<WorkerEndpointOverviewDto>,
  ): Promise<WorkerEndpointOverviewDto> {
    if (this.disposed) {
      throw createAppError('common.unavailable')
    }
    if (this.pendingCommands.has(endpointId)) {
      throw createAppError('endpoint.operation_in_progress')
    }
    const topologyEpoch = this.topologyEpoch
    this.pendingCommands.set(endpointId, kind)
    this.commandEpoch += 1
    this.stopTimer()
    this.publish({ error: null })
    try {
      const overview = await invoke()
      this.commandEpoch += 1
      if (!this.disposed && topologyEpoch === this.topologyEpoch) {
        const next = this.forwardOverview(overview)
        const others = this.snapshot.overviews.filter(
          item => item.endpoint.endpointId !== endpointId,
        )
        this.publish({ overviews: [...others, next] })
      }
      return overview
    } catch (error) {
      if (!this.disposed) {
        this.publish({ error: this.options.formatError(error) })
      }
      throw error
    } finally {
      this.pendingCommands.delete(endpointId)
      this.publish({})
      this.schedulePoll()
    }
  }

  private forwardOverview(next: WorkerEndpointOverviewDto): WorkerEndpointOverviewDto {
    const previous = this.snapshot.overviews.find(
      item => item.endpoint.endpointId === next.endpoint.endpointId,
    )
    if (
      next.operation &&
      previous?.operation?.operationId === next.operation.operationId &&
      previous.operation.revision > next.operation.revision
    ) {
      return previous
    }
    return { ...next, operation: next.operation ?? null }
  }

  private publish(patch: Partial<EndpointOverviewProjection>): void {
    if (this.disposed) {
      return
    }
    const next = { ...this.snapshot, ...patch }
    const busy: Record<string, CommandKind> = Object.fromEntries(this.pendingCommands)
    for (const overview of next.overviews) {
      if (overview.operation) {
        busy[overview.endpoint.endpointId] = overview.operation.kind
      }
    }
    this.snapshot = { ...next, busyByEndpointId: busy }
    for (const listener of this.listeners) {
      listener()
    }
  }

  private stopTimer(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  private schedulePoll(): void {
    this.stopTimer()
    if (
      this.disposed ||
      this.consumers === 0 ||
      this.inFlight ||
      !this.snapshot.overviews.some(overview => overview.operation)
    ) {
      return
    }
    this.cancelTimer = this.options.schedule(() => {
      this.cancelTimer = null
      void this.reload()
    }, 500)
  }
}
