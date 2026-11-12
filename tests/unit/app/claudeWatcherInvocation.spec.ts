// @vitest-environment node
import { expect, it } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'

it('captures the real terminal invocation before clear watcher IO and fences replacement callbacks', async () => {
  const f = await clearIngressFixture(false, true)
  try {
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    const input = {
      sessionId: 's',
      provider: 'claude-code' as const,
      resumeSessionId: 'B',
      cwd: '/workspace',
      startedAtMs: Date.now(),
      launchMode: 'resume' as const,
    }
    const events: TerminalSessionStateEvent[] = []
    const publish = createSessionStatePublisher({
      getInput: () => input,
      onState: event => {
        events.push(event)
        f.runtime.observe(event)
      },
    })
    const captured = captureSessionStateObservation(
      input,
      1,
      record => f.runtime.observeClaudeTranscript(record),
      publish,
    )
    expect(captured.incarnation).toBe('terminal-invocation')
    expect(captured.incarnation).not.toBe(input.sessionId)
    expect(captured.generation).toBeTypeOf('number')
    await f.settle()
    captured.state('s', 'working')
    expect(getPromptSubmissionEvidence(events.at(-1)!)).toMatchObject({
      invocationId: 'terminal-invocation',
      conversationGeneration: captured.generation,
      providerSessionId: 'B',
    })
    expect(f.fence().snapshot).toMatchObject({
      state: 'working',
      quality: 'inferred',
      source: 'session_file',
    })
    f.runtime.metadata({
      sessionId: 's',
      resumeSessionId: null,
      terminalAgentActivity: {
        provider: 'claude-code',
        invocationId: 'replacement',
        generation: 2,
        phase: 'active',
        observedAtMs: Date.now(),
      },
    })
    const replacement = f.fence()
    captured.state('s', 'waiting')
    expect(events.at(-1)?.state).toBe('waiting')
    expect(f.fence()).toEqual(replacement)
  } finally {
    await f.close()
  }
})
