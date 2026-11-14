import { expect, it, vi } from 'vitest'
import { captureInputProvenance } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherEvidence'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'

it.each(['matching', 'pre-clear', 'replaced-generation', 'replaced-invocation'])(
  'binds a delivery capture only to its original invocation and generation: %s',
  variant => {
    const generation = variant === 'pre-clear' ? undefined : 2
    const target = {
      providerSessionId: 'B',
      invocationId: 'invocation',
      conversationGeneration: generation,
    }
    const capture = { id: 'B', startAt: 20 }
    const emit = vi.fn((record: ClaudeTranscriptObservation) => {
      expect(record.providerSessionId).toBe('B')
      expect(record.incarnation).toBe('invocation')
      record.captureConversation?.(
        variant === 'replaced-generation' ? 3 : generation,
        variant === 'replaced-invocation' ? 'other-invocation' : 'invocation',
      )
      record.captureBinding?.(capture)
    })
    const evidence = captureInputProvenance('s', target, emit)
    expect(evidence?.conversationCapture).toBe(
      ['matching', 'pre-clear'].includes(variant) ? capture : undefined,
    )
    expect(evidence).toMatchObject(target)
  },
)
it('never attributes a human write or invents a capture without the private registry port', () => {
  const emit = vi.fn()
  expect(captureInputProvenance('s', undefined, emit)).toBeUndefined()
  expect(emit).not.toHaveBeenCalled()
  const target = { providerSessionId: 'B', invocationId: 'invocation' }
  expect(captureInputProvenance('s', target)).toBe(target)
})
