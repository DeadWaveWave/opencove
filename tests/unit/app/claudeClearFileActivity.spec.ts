// @vitest-environment node
import { expect, it } from 'vitest'
import { clearIngressFixture, clearTranscript } from './claudeClearIngress.helpers'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'

it.each(['working', 'waiting'] as const)(
  'revokes a clear receipt for accepted file %s before later transcript callbacks',
  async state => {
    const f = await clearIngressFixture()
    try {
      await f.send('B', 'SessionStart', 10, undefined, 'clear')
      expect(f.fence().claudeClearReady).toBe(true)
      const input = {
        sessionId: 's',
        provider: 'claude-code' as const,
        resumeSessionId: 'B',
        cwd: '/workspace',
        startedAtMs: Date.now(),
        launchMode: 'resume' as const,
      }
      const publish = createSessionStatePublisher({
        getInput: () => input,
        onState: event => f.runtime.observe(event),
      })
      const captured = captureSessionStateObservation(
        input,
        1,
        record => f.runtime.observeClaudeTranscript(record),
        publish,
      )
      expect(captured.generation).toBe(f.fence().conversationGeneration)
      captured.state('s', state)
      expect(f.fence().claudeClearReady).toBe(false)
      const assistant = clearTranscript.find(line => JSON.parse(line).type === 'assistant')!
      expect(parseClaudeTranscript(assistant)?.kind).toBe('assistant')
      f.transcript('B')(assistant)
      f.runtime.observeClaudeTranscript({
        sessionId: 's',
        incarnation: 's',
        providerSessionId: 'B',
        conversationGeneration: captured.generation,
        generation: 1,
        fileIdentity: 'B.jsonl',
        position: 100,
        baseline: false,
        origin: 'hook',
        record: { kind: 'checkpoint', final: false, queueEmpty: true },
      })
      expect(f.fence()).toMatchObject({
        claudeClearReady: false,
        lastTurnEnd: null,
        snapshot: { state, quality: 'inferred', source: 'session_file' },
      })
      for (const mode of ['refuse', 'steer'] as const) {
        expect(
          promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), mode),
        ).not.toBeNull()
      }
    } finally {
      await f.close()
    }
  },
)

it('keeps a receipt when a current-generation working observation is rejected as stale', async () => {
  const f = await clearIngressFixture()
  try {
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    const generation = f.fence().conversationGeneration
    const evidence = { providerSessionId: 'B', conversationGeneration: generation }
    f.registry.observe(
      's',
      {
        incarnation: 's',
        source: 'session_file',
        sourceSequence: 100,
        observedAt: Date.now(),
        state: 'idle',
      },
      evidence,
    )
    const before = f.fence()
    f.registry.observe(
      's',
      {
        incarnation: 's',
        source: 'session_file',
        sourceSequence: 99,
        observedAt: Date.now(),
        state: 'working',
      },
      evidence,
    )
    expect(f.fence()).toEqual(before)
    expect(f.fence().claudeClearReady).toBe(true)
  } finally {
    await f.close()
  }
})
