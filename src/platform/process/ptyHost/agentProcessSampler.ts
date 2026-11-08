import { AgentProcessOwnership } from './agentProcessOwnership'
import {
  PROCESS_TABLE_READ_TIMEOUT_MS,
  readPosixProcessTable,
  type ProcessIdentity,
} from './posixProcessTable'

export class AgentProcessSampler {
  private inFlight: Promise<ProcessIdentity[] | null> | null = null
  private pendingObservation: Promise<ProcessIdentity[] | null> | null = null
  private timer: NodeJS.Timeout | null = null
  private paused = false
  public constructor(
    public readonly ownership: AgentProcessOwnership,
    private readonly readTable: (
      signal?: AbortSignal,
    ) => Promise<ProcessIdentity[]> = readPosixProcessTable,
    private readonly log: (message: string) => void,
  ) {}
  public maintainTimer(): void {
    if (this.ownership.size > 0 && !this.paused && !this.timer) {
      this.timer = setInterval(() => {
        void this.sample()
      }, 5_000)
      this.timer.unref()
    } else if ((this.paused || this.ownership.size === 0) && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
  public pause(value: boolean): void {
    this.paused = value
    this.maintainTimer()
  }
  public async fresh(): Promise<ProcessIdentity[] | null> {
    // A scan begun before close cannot be its pre-HUP sample. Drain it first.
    if (this.inFlight) {
      await this.inFlight
    }
    return await this.sample()
  }
  public observation(): Promise<ProcessIdentity[] | null> {
    // Foreground probes are control evidence (terminal agent re-entry trusts them as current),
    // so each needs a table read that starts after it was requested: never the interval cache
    // and never a read already in flight. Probes that arrive before that read starts share it.
    if (this.pendingObservation) {
      return this.pendingObservation
    }
    const slot: { promise?: Promise<ProcessIdentity[] | null> } = {}
    slot.promise = (async () => {
      // Yield first so this observation is registered before it can start its read.
      await Promise.resolve()
      while (this.inFlight) {
        // eslint-disable-next-line no-await-in-loop -- wait for every read that began earlier
        await this.inFlight
      }
      if (this.pendingObservation === slot.promise) {
        this.pendingObservation = null
      }
      return await this.sample()
    })()
    this.pendingObservation = slot.promise
    return slot.promise
  }
  public sample(): Promise<ProcessIdentity[] | null> {
    if (this.inFlight) {
      return this.inFlight
    }
    this.inFlight = Promise.resolve().then(async () => {
      const captureIds = this.ownership.ids()
      const controller = new AbortController()
      let timer: NodeJS.Timeout | undefined
      try {
        const rows = await Promise.race([
          this.readTable(controller.signal),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort()
              reject(new Error('process table deadline exceeded'))
            }, PROCESS_TABLE_READ_TIMEOUT_MS)
          }),
        ])
        this.ownership.observe(rows, captureIds)
        return rows
      } catch (error) {
        // Never bind an unknown launch identity on a later, potentially recycled PID.
        this.ownership.abandonCapture(captureIds)
        this.log(`process table read failed: ${String(error)}`)
        return null
      } finally {
        clearTimeout(timer)
        this.inFlight = null
      }
    })
    return this.inFlight
  }
}
