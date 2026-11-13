import { expect, it } from 'vitest'
import {
  SessionTurnStateProjection,
  type SessionFileStateOptions,
} from '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateProjection'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { getClaudeStateRecord } from '../../../src/shared/runtime/agentHook/claudeTranscript'

it.each([false, true])(
  'bounds unresolved baseline records without treating metadata as activity, metadata=%s',
  metadata => {
    const states: { state: string; options?: SessionFileStateOptions }[] = []
    const projection = new SessionTurnStateProjection('claude-code', (state, options) =>
      states.push({ state, options }),
    )
    for (let n = 0; n < 128; n++) {
      const line = JSON.stringify({
        type: 'user',
        uuid: `r${n}`,
        isMeta: metadata,
        message: { content: metadata ? 'metadata' : 'actual input' },
      })
      projection.observe(line, true, parseClaudeTranscript(line))
    }
    expect((projection as unknown as { baselineRecords: Set<unknown> }).baselineRecords.size).toBe(
      metadata ? 0 : 64,
    )
    projection.flushBaseline()
    expect(states).toHaveLength(1)
    expect(states[0].options?.claudeAuxiliary).toBe(metadata ? true : undefined)
    if (!metadata) {
      expect(getClaudeStateRecord(states[0].options!)).toBeUndefined()
    }
    projection.reset()
    expect((projection as unknown as { baselineRecords: Set<unknown> }).baselineRecords.size).toBe(
      0,
    )
  },
)
