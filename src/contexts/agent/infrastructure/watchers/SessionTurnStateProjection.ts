import type { AgentProviderId, TerminalSessionState } from '../../../../shared/contracts/dto'
import { detectTurnObservationFromSessionLine } from './SessionTurnStateDetector'
import { boundedInsert } from '../../../../shared/utils/boundedInsert'
import {
  getClaudeTranscriptInput,
  getClaudeTranscriptCompleted,
  markClaudeStateRecord,
  type ClaudeTranscriptRecord,
} from '../../../../shared/runtime/agentHook/claudeTranscript'

export interface SessionFileStateOptions {
  claudeAuxiliary?: true
  hookEventName?: string
  /** Folded history, never evidence of a new turn boundary. */
  baseline?: boolean
}

/** Separates historical state reconstruction from live turn observations. */
export class SessionTurnStateProjection {
  private lastState: TerminalSessionState | null = null
  private baselineRecords = new Set<ClaudeTranscriptRecord>()
  private baselineOpaque = false
  private baselineRecord?: ClaudeTranscriptRecord
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
    this.clearBaseline()
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
    const options: SessionFileStateOptions = {
      baseline: true,
      ...(!this.baselineOpaque &&
      [...this.baselineRecords].every(r => getClaudeTranscriptInput(r) === 'auxiliary')
        ? { claudeAuxiliary: true }
        : {}),
    }
    const unresolved = [...this.baselineRecords].find(
      r => getClaudeTranscriptInput(r) !== 'auxiliary' && !getClaudeTranscriptCompleted(r),
    )
    const representative = unresolved ?? this.baselineRecord
    if (!this.baselineOpaque && representative) {
      markClaudeStateRecord(options, representative)
    }
    this.clearBaseline()
    this.publish(this.lastState, options)
  }
  private clearBaseline(): void {
    this.baselineRecords.clear()
    this.baselineOpaque = false
    this.baselineRecord = undefined
  }

  observe(line: string, baseline: boolean, record?: ClaudeTranscriptRecord): void {
    const observation = detectTurnObservationFromSessionLine(this.provider, line)
    const state = observation?.state
    if (baseline) {
      this.baselineRecords.forEach(item => {
        if (getClaudeTranscriptInput(item) === 'auxiliary') {
          this.baselineRecords.delete(item)
        }
      })
      if (state) {
        this.baselineState = state
        this.baselineRecord = record
        if (!record) {
          this.baselineOpaque ||= !observation?.claudeAuxiliary
        } else if (getClaudeTranscriptInput(record) !== 'auxiliary') {
          boundedInsert(
            this.baselineRecords.size,
            64,
            () => this.baselineRecords.add(record),
            () => {
              this.baselineOpaque = true
            },
          )
        }
      }
      return
    }
    this.flushBaseline()
    let hookEventName: string | undefined
    if (this.provider === 'codex') {
      try {
        const codexRecord = JSON.parse(line)
        const name = codexRecord?.type === 'event_msg' ? codexRecord?.payload?.type : undefined
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
    const options: SessionFileStateOptions | undefined = (
      record ? getClaudeTranscriptInput(record) === 'auxiliary' : observation?.claudeAuxiliary
    )
      ? { claudeAuxiliary: true }
      : hookEventName
        ? { hookEventName }
        : record
          ? {}
          : undefined
    if (options && record) {
      markClaudeStateRecord(options, record)
    }
    this.publish(state, options)
  }
}
