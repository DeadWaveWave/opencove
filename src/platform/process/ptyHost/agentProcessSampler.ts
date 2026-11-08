import { AgentProcessOwnership } from './agentProcessOwnership'
import {
  PROCESS_TABLE_READ_TIMEOUT_MS,
  readPosixProcessTable,
  type ProcessIdentity,
} from './posixProcessTable'

export class AgentProcessSampler {
  private inFlight: Promise<ProcessIdentity[] | null> | null = null
  private timer: NodeJS.Timeout | null = null
  private paused = false
  private latest: ProcessIdentity[] | null = null
  private sampledAt = -Infinity
  public constructor(
    public readonly ownership: AgentProcessOwnership,
    private readonly readTable: (
      signal?: AbortSignal,
    ) => Promise<ProcessIdentity[]> = readPosixProcessTable,
    private readonly log: (message: string) => void,
    private readonly now: () => number = () => performance.now(),
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
    if (this.inFlight) {
      return this.inFlight
    }
    // Foreground hints may reuse one interval's observation. Retirement and
    // launch identity capture deliberately bypass this cache through sample/fresh.
    if (this.paused || this.now() - this.sampledAt < 5_000) {
      return Promise.resolve(this.latest)
    }
    return this.sample()
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
        this.latest = rows
        this.ownership.observe(rows, captureIds)
        return rows
      } catch (error) {
        // Never bind an unknown launch identity on a later, potentially recycled PID.
        this.latest = null
        this.ownership.abandonCapture(captureIds)
        this.log(`process table read failed: ${String(error)}`)
        return null
      } finally {
        clearTimeout(timer)
        this.sampledAt = this.now()
        this.inFlight = null
      }
    })
    return this.inFlight
  }
}
