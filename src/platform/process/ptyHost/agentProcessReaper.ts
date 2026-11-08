/* eslint-disable no-await-in-loop -- One host-wide scheduler must serialize process-table reads and phase waits. */
import process from 'node:process'
import { AGENT_RETIREMENT_BUDGET_MS } from './terminationTiming'
import { sameProcess, AgentProcessOwnership } from './agentProcessOwnership'
import { AgentProcessSampler } from './agentProcessSampler'
import {
  ProcessTreeSnapshot,
  PROCESS_TABLE_READ_TIMEOUT_MS,
  type ProcessIdentity,
} from './posixProcessTable'
export type { ProcessIdentity } from './posixProcessTable'
export type PtySessionKind = 'agent' | 'shell'

type Stage = 'hup' | 'term' | 'kill'
type Retirement = {
  targets: Map<string, ProcessIdentity>
  stage: Stage
  dueAt: number
  deadline: number
  hangup?: () => void
  done: () => void
  promise: Promise<void>
}
interface ReaperDependencies {
  platform?: NodeJS.Platform
  now?: () => number
  readTable?: (signal?: AbortSignal) => Promise<ProcessIdentity[]>
  signal?: (pid: number, signal: NodeJS.Signals) => void
  reportIssue?: (message: string) => void
}

/** One host-wide lifetime sampler and retirement scheduler, including exited Agent windows. */
export class AgentProcessReaper {
  private readonly ownership: AgentProcessOwnership
  private readonly sampler: AgentProcessSampler
  private readonly jobs = new Map<string, Retirement>()
  private running: Promise<void> | null = null
  private wake: (() => void) | null = null
  private readonly now: () => number
  private readonly signal: (pid: number, signal: NodeJS.Signals) => void
  private readonly reportIssue: (message: string) => void
  private readonly enabled: boolean
  public constructor(dependencies: ReaperDependencies = {}) {
    this.now = dependencies.now ?? (() => performance.now())
    this.signal = dependencies.signal ?? ((pid, signal) => process.kill(pid, signal))
    this.reportIssue =
      dependencies.reportIssue ??
      (message => {
        process.stderr.write(`${message}\n`)
      })
    const platform = dependencies.platform ?? process.platform
    this.enabled = platform === 'darwin' || platform === 'linux'
    this.ownership = new AgentProcessOwnership(message => this.log(message))
    this.sampler = new AgentProcessSampler(
      this.ownership,
      dependencies.readTable,
      message => this.log(message),
      this.now,
    )
  }
  public async track(sessionId: string, rootPid: number): Promise<void> {
    if (!this.enabled) {
      return
    }
    this.ownership.add(sessionId, rootPid)
    await this.sampler.sample()
    if (this.ownership.needsCapture(sessionId)) {
      await this.sampler.sample()
    }
    this.sampler.maintainTimer()
  }
  public noteExit(sessionId: string): void {
    this.ownership.noteExit(sessionId)
  }
  public readTable(): Promise<ProcessIdentity[] | null> {
    return this.sampler.observation()
  }
  public terminate(sessionId: string, hangup?: () => void): Promise<void> {
    const existing = this.jobs.get(sessionId)
    if (existing) {
      return existing.promise
    }
    if (!this.ownership.ids().includes(sessionId)) {
      return Promise.resolve()
    }
    let done!: () => void
    const promise = new Promise<void>(resolve => {
      done = resolve
    })
    this.jobs.set(sessionId, {
      targets: new Map(),
      stage: 'hup',
      dueAt: this.now(),
      deadline: this.now() + AGENT_RETIREMENT_BUDGET_MS,
      hangup,
      done,
      promise,
    })
    this.sampler.pause(true)
    this.wake?.()
    this.running ??= Promise.resolve().then(() => this.run())
    return promise
  }
  public async drain(): Promise<void> {
    for (const id of this.ownership.ids()) {
      void this.terminate(id)
    }
    while (this.running) {
      await this.running
    }
  }
  private log(message: string): void {
    try {
      this.reportIssue(`[pty-host] agent reaper ${message}`)
    } catch {
      /* Logging cannot break cleanup. */
    }
  }
  private async wait(delay: number): Promise<void> {
    if (delay <= 0) {
      return
    }
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.wake = null
        resolve()
      }, delay)
      this.wake = () => {
        clearTimeout(timer)
        this.wake = null
        resolve()
      }
    })
  }
  private async run(): Promise<void> {
    try {
      while (this.jobs.size > 0) {
        const next = [...this.jobs.values()].sort((a, b) => a.dueAt - b.dueAt)[0]!
        await this.wait(next.dueAt - this.now())
        // Freeze all currently due phases before any await. Overlapping cohorts
        // share this read, so old KILL work cannot starve a later close's first HUP.
        // A job arriving during the query is excluded until its own fresh read.
        const phaseOrder: Record<Stage, number> = { kill: 0, term: 1, hup: 2 }
        const batch = [...this.jobs]
          .filter(([, job]) => job.dueAt <= this.now())
          .map(([id, job]) => ({ id, job, stage: job.stage }))
          .sort((a, b) => phaseOrder[a.stage] - phaseOrder[b.stage])
        if (batch.length === 0) {
          continue
        }
        const rows = await this.sampler.fresh()
        const table = new ProcessTreeSnapshot(rows ?? [])
        const { byPid } = table
        const signalled = new Set<number>()
        for (const { id, job, stage } of batch) {
          // Bound long-lived history separately from the current close-time tree.
          // Retain every observed retirement target across HUP/reparenting, even if
          // the live tree exceeds the 512-member lifetime-history limit.
          for (const target of this.ownership.targets(id, table, job.targets.values())) {
            job.targets.set(`${target.pid}:${target.startTime}`, target)
          }
          for (const [identity, target] of job.targets) {
            if (rows && !sameProcess(target, byPid.get(target.pid))) {
              job.targets.delete(identity)
            }
          }
          if (stage === 'hup') {
            if (this.ownership.verifiedRoot(id, byPid)) {
              try {
                job.hangup?.()
              } catch (error) {
                this.log(`HUP failed: ${String(error)}`)
              }
            }
            job.stage = 'term'
            job.dueAt = this.now() + 150
          } else {
            const cutoff = job.deadline - PROCESS_TABLE_READ_TIMEOUT_MS - 200
            const targets = [...job.targets.values()].filter(target =>
              sameProcess(target, byPid.get(target.pid)),
            )
            for (const target of targets) {
              if (stage === 'term' && this.now() >= cutoff) {
                this.log(`session=${id} TERM budget exhausted; reserving KILL`)
                break
              }
              if (signalled.has(target.pid)) {
                continue
              }
              signalled.add(target.pid)
              try {
                this.signal(target.pid, stage === 'term' ? 'SIGTERM' : 'SIGKILL')
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                  this.log(`pid=${target.pid} ${stage} failed: ${String(error)}`)
                }
              }
            }
            if (stage === 'term') {
              job.stage = 'kill'
              job.dueAt = Math.min(this.now() + 500, cutoff)
            } else {
              this.ownership.remove(id)
              this.jobs.delete(id)
              job.done()
            }
          }
        }
      }
    } finally {
      this.running = null
      this.sampler.pause(false)
    }
  }
}
