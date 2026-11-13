import { afterEach, expect, it, vi } from 'vitest'
import { hook, orderingFixture } from './claudeConversationOrdering.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'

afterEach(() => vi.useRealTimers())
const capability = () => ({ supported: true as const, submitDelayMs: 300 })
it('bypasses generation requirements until authenticated clear establishes a fence', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture()
  try {
    expect(
      f.registry.acceptsObservation('s', 'session_file', {
        conversationGeneration: 0,
        providerSessionId: 'A',
      }),
    ).toBe(true)
    expect(
      f.registry.acceptsObservation('s', 'session_file', {
        conversationGeneration: 0,
        providerSessionId: 'B',
      }),
    ).toBe(true)
    f.send({ ...hook('B', 'SessionStart', 10), sessionStartSource: 'resume' })
    expect(
      f.registry.acceptsObservation('s', 'session_file', {
        conversationGeneration: 0,
        providerSessionId: 'B',
      }),
    ).toBe(true)
    f.send(hook('C', 'SessionStart', 20))
    vi.advanceTimersByTime(200)
    expect(
      f.registry.acceptsObservation('s', 'session_file', {
        conversationGeneration: f.fence().conversationGeneration,
        providerSessionId: 'C',
      }),
    ).toBe(true)
  } finally {
    f.registry.dispose()
  }
})
it('accepts fresh resume back to A and refuses input while A is working', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture()
  try {
    f.send({ ...hook('B', 'SessionStart', 10), sessionStartSource: 'resume' })
    f.send(hook('B', 'UserPromptSubmit', 20))
    f.send(hook('B', 'Stop', 25))
    expect(promptAdmission(f.fence(), capability, 'refuse')).toBeNull()
    const beforeStale = f.fence()
    f.send({ ...hook('A', 'SessionStart', 5), sessionStartSource: 'resume' })
    expect(f.fence()).toEqual(beforeStale)
    f.send({ ...hook('A', 'SessionStart', 30), sessionStartSource: 'resume' })
    f.send(hook('A', 'UserPromptSubmit', 40))
    expect(f.fence()).toMatchObject({
      claudeClearReady: false,
      snapshot: { state: 'working', quality: 'authoritative', turn: { id: 't2' } },
    })
    expect(f.registry.promptIdentity(f.fence())?.providerSessionId).toBe('A')
    expect(promptAdmission(f.fence(), capability, 'refuse')).toMatchObject({ code: 'agent.busy' })
    expect(f.registry.finalMessage({ nodeId: 'n', turnId: 't1' })).toMatchObject({
      message: 'reply-B',
    })
  } finally {
    f.registry.dispose()
  }
})
it('accepts discovered file-only identity through actual generation-zero watcher capture before hooks', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
  const input = {
    sessionId: 's',
    provider: 'claude-code' as const,
    resumeSessionId: null,
    cwd: '/workspace',
    startedAtMs: Date.now(),
    launchMode: 'new' as const,
  }
  const emitted = vi.fn()
  const publish = createSessionStatePublisher({
    getInput: () => input,
    onState: event => {
      emitted(event)
      f.runtime.observe(event)
    },
  })
  const captured = captureSessionStateObservation(
    input,
    1,
    record => f.runtime.observeClaudeTranscript(record),
    publish,
  )
  try {
    expect(captured.generation).toBeUndefined()
    captured.bind('discovered-A')
    captured.state('s', 'working')
    expect(getPromptSubmissionEvidence(emitted.mock.calls[0][0])).toMatchObject({
      conversationGeneration: undefined,
      providerSessionId: undefined,
      conversationCapture: expect.any(Object),
    })
    expect(f.registry.get({ sessionId: 's' })).toMatchObject({
      state: 'working',
      quality: 'inferred',
      source: 'session_file',
    })
    captured.state('s', 'standby')
    captured.state('s', 'working')
    expect(f.registry.get({ sessionId: 's' })).toMatchObject({
      state: 'working',
      quality: 'inferred',
    })
  } finally {
    f.dispose()
  }
})
