import { AgentProcessOwnership } from './agentProcessOwnership'
import {
  PROCESS_TABLE_READ_TIMEOUT_MS,
  readPosixProcessTable,
  type ProcessTableReadOptions,
  type ProcessTableSample,
} from './posixProcessTable'

type Read = {
  promise: Promise<ProcessTableSample | null>
  retirement: boolean
  cancel: () => void
}
export class AgentProcessSampler {
  private inFlight: Read | null = null
  private pendingObservation: Promise<ProcessTableSample | null> | null = null
  private timer: NodeJS.Timeout | null = null
  private resumed: Promise<void> | null = null
  private resume: (() => void) | null = null
  public constructor(
    public readonly ownership: AgentProcessOwnership,
    private readonly readTable: (
      options: ProcessTableReadOptions,
    ) => Promise<ProcessTableSample> = readPosixProcessTable,
    private readonly log: (message: string) => void,
  ) {}
  public maintainTimer(): void {
    if (this.ownership.size > 0 && !this.resumed && !this.timer) {
      this.timer = setInterval(() => {
        void this.sample()
      }, 5_000)
      this.timer.unref()
    } else if ((this.resumed || this.ownership.size === 0) && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
  public pause(value: boolean): void {
    if (value) {
      this.resumed ??= new Promise(resolve => {
        this.resume = resolve
      })
      // A foreground/periodic 2s read must not consume the retirement KILL reserve.
      if (this.inFlight && !this.inFlight.retirement) {
        this.inFlight.cancel()
      }
    } else {
      this.resume?.()
      this.resumed = null
      this.resume = null
    }
    this.maintainTimer()
  }
  public async fresh(timeoutMs: number): Promise<ProcessTableSample | null> {
    // The pre-HUP read must start after close. Ordinary reads are cancelled on pause;
    // retirement reads are serialized by the host-wide scheduler.
    if (this.inFlight) {
      await this.inFlight.promise
    }
    return await this.startRead(timeoutMs, true)
  }
  public observation(): Promise<ProcessTableSample | null> {
    // Foreground probes are control evidence (terminal agent re-entry trusts them as current),
    // so each needs a table read that starts after it was requested: never the interval cache
    // and never a read already in flight. Probes that arrive before that read starts share it.
    if (this.pendingObservation) {
      return this.pendingObservation
    }
    const slot: { promise?: Promise<ProcessTableSample | null> } = {}
    slot.promise = (async () => {
      await Promise.resolve()
      while (this.inFlight || this.resumed) {
        // eslint-disable-next-line no-await-in-loop -- Wait for earlier reads and retirement.
        await (this.resumed ?? this.inFlight!.promise)
      }
      if (this.pendingObservation === slot.promise) {
        this.pendingObservation = null
      }
      return await this.sample()
    })()
    this.pendingObservation = slot.promise
    return slot.promise
  }
  public sample(): Promise<ProcessTableSample | null> {
    if (this.resumed) {
      return this.resumed.then(() => this.sample())
    }
    return this.startRead(PROCESS_TABLE_READ_TIMEOUT_MS, false)
  }
  private startRead(timeoutMs: number, retirement: boolean): Promise<ProcessTableSample | null> {
    if (this.inFlight) {
      return this.inFlight.promise
    }
    const controller = new AbortController()
    let cancelled = false
    let cancel!: () => void
    const cancellation = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        cancelled = true
        reject(new Error('process table read preempted for retirement'))
        controller.abort()
      }
    })
    const read: Read = {
      retirement,
      cancel,
      promise: Promise.resolve().then(async () => {
        const captureIds = this.ownership.ids()
        let timer: NodeJS.Timeout | undefined
        try {
          const sample = await Promise.race([
            // Never launch an already preempted query.
            cancelled ? cancellation : this.readTable({ signal: controller.signal, timeoutMs }),
            cancellation,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                reject(new Error('process table deadline exceeded'))
                controller.abort()
              }, timeoutMs)
            }),
          ])
          this.ownership.observe(sample.rows, captureIds, sample.complete)
          return sample
        } catch (error) {
          if (!cancelled) {
            // Never bind an unknown launch identity after a failed first read.
            // Scheduling preemption instead replaces that read with the fresh pre-HUP
            // query, still inside the accepted initial asynchronous identity gap.
            this.ownership.abandonCapture(captureIds)
            this.log(`process table read failed: ${String(error)}`)
          }
          return null
        } finally {
          clearTimeout(timer)
          if (this.inFlight === read) {
            this.inFlight = null
          }
        }
      }),
    }
    this.inFlight = read
    return read.promise
  }
}
