import { expect, it } from 'vitest'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'

it.each(['working', 'error'])(
  'retains discovered file identity for %s before the first hook',
  kind => {
    const f = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
    const input = {
      sessionId: 's',
      provider: 'claude-code' as const,
      cwd: '/',
      launchMode: 'new' as const,
      resumeSessionId: null,
      startedAtMs: Date.now(),
    }
    const events: TerminalSessionStateEvent[] = []
    try {
      const observed = captureSessionStateObservation(
        input,
        1,
        record => f.runtime.observeClaudeTranscript(record),
        createSessionStatePublisher({
          getInput: () => input,
          onState: event => {
            events.push(event)
            f.runtime.observe(event)
          },
        }),
      )
      expect(observed.generation).toBeUndefined()
      observed.bind('discovered-A')
      if (kind === 'error') {
        observed.unavailable('s')
      } else {
        observed.state('s', 'working')
      }
      expect(getPromptSubmissionEvidence(events[0])).toMatchObject({
        providerSessionId: 'discovered-A',
        conversationGeneration: undefined,
        invocationId: 's',
        conversationCapture: expect.objectContaining({ id: 'discovered-A' }),
      })
    } finally {
      f.dispose()
    }
  },
)
it.each([null, 'A'])(
  'captures the actual invocation before IO if the initial capture had no owner, initial ID=%s',
  initial => {
    const f = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
    let available = false
    const input = {
      sessionId: 's',
      provider: 'claude-code' as const,
      cwd: '/',
      launchMode: 'new' as const,
      resumeSessionId: initial,
      startedAtMs: Date.now(),
    }
    const events: TerminalSessionStateEvent[] = []
    try {
      f.runtime.metadata({
        sessionId: 's',
        resumeSessionId: null,
        terminalAgentActivity: {
          provider: 'claude-code',
          invocationId: 'actual-invocation',
          generation: 1,
          phase: 'active',
          observedAtMs: Date.now(),
        },
      })
      const observed = captureSessionStateObservation(
        input,
        1,
        record => {
          if (available) {
            f.runtime.observeClaudeTranscript(record)
          }
        },
        createSessionStatePublisher({
          getInput: () => input,
          onState: event => events.push(event),
        }),
      )
      expect(observed.incarnation).toBeUndefined()
      available = true
      observed.bind('A')
      observed.state('s', 'working')
      expect(getPromptSubmissionEvidence(events[0])).toMatchObject({
        providerSessionId: 'A',
        invocationId: 'actual-invocation',
        conversationCapture: expect.objectContaining({ id: 'A' }),
      })
    } finally {
      f.dispose()
    }
  },
)
