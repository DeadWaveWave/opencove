// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

it.each(['working', 'waiting'] as const)(
  'retains captured successor %s throughout the first clear',
  async state => {
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
      const captured = captureSessionStateObservation(
        input,
        1,
        record => f.runtime.observeClaudeTranscript(record),
        createSessionStatePublisher({
          getInput: () => input,
          onState: event => f.runtime.observe(event),
        }),
      )
      expect(captured.generation).toBeUndefined()
      await f.send('A', 'SessionEnd', 19, undefined, undefined, { reason: 'clear' })
      captured.state('s', state)
      expect(
        promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
      ).not.toBeNull()
      await f.send('B', 'SessionStart', 20, undefined, 'clear')
      await vi.advanceTimersByTimeAsync(200)
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
