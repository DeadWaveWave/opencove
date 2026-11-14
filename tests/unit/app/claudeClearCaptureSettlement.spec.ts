// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture, clearTranscript } from './claudeClearIngress.helpers'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'

it.each(['working', 'waiting', 'input'] as const)(
  'retains pre-clear successor %s provenance after quiet',
  async activity => {
    const f = await clearIngressFixture(false)
    try {
      const input = {
        sessionId: 's',
        provider: 'claude-code' as const,
        resumeSessionId: 'B',
        cwd: '/',
        startedAtMs: Date.now(),
        launchMode: 'resume' as const,
      }
      const capture = captureSessionStateObservation(
        input,
        1,
        record => f.runtime.observeClaudeTranscript(record),
        createSessionStatePublisher({
          getInput: () => input,
          onState: event => f.runtime.observe(event),
        }),
      )
      await f.send('A', 'SessionEnd', 19, undefined, undefined, { reason: 'clear' })
      await f.send('B', 'SessionStart', 20, undefined, 'clear')
      await vi.advanceTimersByTimeAsync(201)
      expect(f.fence().claudeClearReady).toBe(true)
      if (activity === 'input') {
        f.runtime.observeClaudeTranscript({
          sessionId: 's',
          incarnation: capture.incarnation,
          providerSessionId: 'B',
          conversationGeneration: capture.generation,
          conversationCapture: capture.capture,
          generation: 1,
          fileIdentity: 'B.jsonl',
          position: 7,
          baseline: true,
          origin: 'session_file',
          record: parseClaudeTranscript(clearTranscript[6]),
        })
      } else {
        capture.state('s', activity)
      }
      const result = f.service
        .deliver({ nodeId: 'n', text: 'MUST_NOT_WRITE', whenBusy: 'refuse', timeoutMs: 1000 })
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(1000)
      await result
      expect({ ready: f.fence().claudeClearReady, writes: f.write.mock.calls.length }).toEqual({
        ready: false,
        writes: 0,
      })
    } finally {
      await f.close()
    }
  },
)
