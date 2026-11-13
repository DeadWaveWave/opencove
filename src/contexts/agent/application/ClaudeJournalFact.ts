import type { AgentRunTurnEnd } from '../domain/agentRunState'
import type { ClaudeCaptureBinding } from './ClaudeCaptureBindings'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'

export type JournalFact = {
  kind: 'start' | 'end' | 'activity' | 'finish' | 'complete'
  id: string
  at: number
  received: number
  promptId?: string
  capture?: ClaudeCaptureBinding
  input?: boolean
  io?: boolean
  order?: number
  clear?: boolean
  receipt?: AgentRunTurnEnd
  hookName?: string
  source?: string
  key: string
}

export function claudeRequestFact(
  request: NonNullable<ClaudeTranscriptObservation['conversation']>,
): JournalFact {
  const e = request.event
  return {
    kind:
      e.hookEventName === 'SessionStart'
        ? 'start'
        : e.hookEventName === 'SessionEnd'
          ? 'end'
          : ['Stop', 'StopFailure'].includes(e.hookEventName)
            ? 'finish'
            : 'activity',
    id: e.claudeSessionId,
    at: e.emittedAtMs!,
    received: 0,
    key: '',
    promptId: e.promptId,
  }
}
