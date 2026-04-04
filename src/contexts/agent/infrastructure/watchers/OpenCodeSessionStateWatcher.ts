import type { AgentLaunchMode, TerminalSessionState } from '../../../../shared/contracts/dto'
import { readOpenCodeSessionStatus } from './OpenCodeSessionApi'

interface OpenCodeSessionStateWatcherOptions {
  sessionId: string
  opencodeSessionId: string
  baseUrl: string
  cwd: string
  launchMode: AgentLaunchMode
  onState: (sessionId: string, state: TerminalSessionState) => void
  onError?: (error: unknown) => void
}

const OPENCODE_STATUS_POLL_INTERVAL_MS = 500
const OPENCODE_STATE_TRANSITION_STABILITY_POLLS = 2

export class OpenCodeSessionStateWatcher {
  private readonly sessionId: string
  private readonly opencodeSessionId: string
  private readonly baseUrl: string
  private readonly cwd: string
  private readonly launchMode: AgentLaunchMode
  private readonly onState: (sessionId: string, state: TerminalSessionState) => void
  private readonly onError?: (error: unknown) => void

  private disposed = false
  private lastState: TerminalSessionState | null = null
  private hasObservedActiveState = false
  private pendingState: TerminalSessionState | null = null
  private pendingStatePollCount = 0
  private timer: NodeJS.Timeout | null = null

  public constructor(options: OpenCodeSessionStateWatcherOptions) {
    this.sessionId = options.sessionId
    this.opencodeSessionId = options.opencodeSessionId
    this.baseUrl = options.baseUrl
    this.cwd = options.cwd
    this.launchMode = options.launchMode
    this.onState = options.onState
    this.onError = options.onError
  }

  public start(): void {
    if (this.disposed) {
      return
    }

    void this.poll()
  }

  public dispose(): void {
    this.disposed = true

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNextPoll(): void {
    if (this.disposed) {
      return
    }

    this.timer = setTimeout(() => {
      void this.poll()
    }, OPENCODE_STATUS_POLL_INTERVAL_MS)
    this.timer.unref?.()
  }

  private resolveNextState(status: 'busy' | 'retry' | 'idle' | null): TerminalSessionState | null {
    if (status === 'busy' || status === 'retry') {
      this.hasObservedActiveState = true
      return 'working'
    }

    if (status === 'idle') {
      return 'standby'
    }

    return this.launchMode === 'resume' || this.hasObservedActiveState ? 'standby' : null
  }

  private async poll(): Promise<void> {
    try {
      const status = await readOpenCodeSessionStatus({
        baseUrl: this.baseUrl,
        cwd: this.cwd,
        sessionId: this.opencodeSessionId,
      })

      if (this.disposed) {
        return
      }

      const nextState = this.resolveNextState(status)
      if (nextState) {
        this.commitStateIfStable(nextState)
      }

      this.scheduleNextPoll()
    } catch (error) {
      if (this.disposed) {
        return
      }

      this.onError?.(error)
    }
  }

  private commitStateIfStable(nextState: TerminalSessionState): void {
    if (this.lastState === null) {
      this.lastState = nextState
      this.pendingState = null
      this.pendingStatePollCount = 0
      this.onState(this.sessionId, nextState)
      return
    }

    if (nextState === this.lastState) {
      this.pendingState = null
      this.pendingStatePollCount = 0
      return
    }

    if (this.pendingState !== nextState) {
      this.pendingState = nextState
      this.pendingStatePollCount = 1
      return
    }

    this.pendingStatePollCount += 1
    if (this.pendingStatePollCount < OPENCODE_STATE_TRANSITION_STABILITY_POLLS) {
      return
    }

    this.lastState = nextState
    this.pendingState = null
    this.pendingStatePollCount = 0
    this.onState(this.sessionId, nextState)
  }
}
