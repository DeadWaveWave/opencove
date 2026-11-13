// @vitest-environment node
import { expect, it } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { probeClearDelivery } from '../../support/clearDeliveryProbe'

it.each(['working', 'waiting'] as const)(
  'keeps retired A fenced after B file %s consumes readiness',
  async state => {
    const f = await clearIngressFixture()
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
      const publish = createSessionStatePublisher({
        getInput: () => input,
        onState: event => f.runtime.observe(event),
      })
      const capture = captureSessionStateObservation(
        input,
        1,
        record => f.runtime.observeClaudeTranscript(record),
        publish,
      )
      capture.state('s', state)
      expect(f.fence().claudeClearReady).toBe(false)
      const errors: string[] = []
      for (const [name, stamp] of [
        ['UserPromptSubmit', 4],
        ['Stop', 5],
        ['SessionEnd', 6],
      ] as const) {
        // oxlint-disable-next-line no-await-in-loop -- every delayed callback is checked independently
        await f.send('A', name, stamp, 'late-A')
        if (f.fence().snapshot.turn) {
          errors.push(`${name}: retired turn`)
        }
        for (const mode of ['refuse', 'steer'] as const) {
          if (
            promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), mode) ===
            null
          ) {
            errors.push(`${name}: admitted ${mode}`)
          }
        }
        // oxlint-disable-next-line no-await-in-loop -- actual dispatch is part of each intermediate invariant
        if ((await probeClearDelivery(f)).writes) {
          errors.push(`${name}: delivery write`)
        }
      }
      expect(errors).toEqual([])
      expect(f.fence().snapshot).toMatchObject({
        state,
        quality: 'inferred',
        source: 'session_file',
        turn: null,
      })
      expect(f.write).not.toHaveBeenCalled()
    } finally {
      await f.close()
    }
  },
)
