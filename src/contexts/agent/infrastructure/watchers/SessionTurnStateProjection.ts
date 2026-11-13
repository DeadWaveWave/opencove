import type { AgentProviderId, TerminalSessionState } from '../../../../shared/contracts/dto'
import { detectTurnObservationFromSessionLine } from './SessionTurnStateDetector'

export interface SessionFileStateOptions {
  claudeAuxiliary?: true
  hookEventName?: string
  /** Folded history, never evidence of a new turn boundary. */
  baseline?: boolean
}

/** Separates historical state reconstruction from live turn observations. */
export class SessionTurnStateProjection {
  private lastState: TerminalSessionState | null = null
  private baselineAuxiliary = true
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
    this.baselineAuxiliary = true
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
    this.publish(this.lastState, {
      baseline: true,
      ...(this.baselineAuxiliary ? { claudeAuxiliary: true } : {}),
    })
    this.baselineAuxiliary = true
  }

  observe(line: string, baseline: boolean): void {
    const observation = detectTurnObservationFromSessionLine(this.provider, line)
    const state = observation?.state
    if (baseline) {
      if (state) {
        this.baselineState = state
        this.baselineAuxiliary &&= observation?.claudeAuxiliary === true
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
    this.publish(
      state,
      observation?.claudeAuxiliary
        ? { claudeAuxiliary: true }
        : hookEventName
          ? { hookEventName }
          : undefined,
    )
  }
}
