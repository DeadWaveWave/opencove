import type { AgentProviderId, TerminalSessionState } from '../../../../shared/contracts/dto'
import { detectTurnStateFromSessionLine } from './SessionTurnStateDetector'

export interface SessionFileStateOptions {
  hookEventName?: string
  /** Folded history, never evidence of a new turn boundary. */
  baseline?: boolean
}

/** Separates historical state reconstruction from live turn observations. */
export class SessionTurnStateProjection {
  private lastState: TerminalSessionState | null = null
  private baselineState: TerminalSessionState | null = null

  constructor(
    private readonly provider: AgentProviderId,
    private readonly publish: (
      state: TerminalSessionState,
      options?: SessionFileStateOptions,
    ) => void,
  ) {}

  reset(): void {
    this.lastState = null
    this.baselineState = null
  }

  noteInteraction(): void {
    this.lastState = 'working'
  }

  flushBaseline(): void {
    if (this.baselineState === null) {
      return
    }
    this.lastState = this.baselineState
    this.baselineState = null
    this.publish(this.lastState, { baseline: true })
  }

  observe(line: string, baseline: boolean): void {
    const state = detectTurnStateFromSessionLine(this.provider, line)
    if (baseline) {
      if (state) {
        this.baselineState = state
      }
      return
    }
    this.flushBaseline()
    let hookEventName: string | undefined
    if (this.provider === 'codex') {
      try {
        const record = JSON.parse(line)
        const name = record?.type === 'event_msg' ? record?.payload?.type : undefined
        if (name === 'task_started' || name === 'task_complete' || name === 'turn_aborted') {
          hookEventName = name
        }
      } catch {
        /* The state detector rejects malformed records. */
      }
    }
    if (!state || (state === this.lastState && !hookEventName)) {
      return
    }
    this.lastState = state
    this.publish(state, hookEventName ? { hookEventName } : undefined)
  }
}
