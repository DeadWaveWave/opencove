import { describe, it, expect } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import {
  sessionLaunchAgentOperation,
  sessionLaunchAgentInMountOperation,
} from '../../../src/shared/contracts/controlSurface/operations/domains/session'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
const expected = {
  activationId: null,
  tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
}
const context = { now: () => new Date() } as ControlSurfaceContext

describe.each([sessionLaunchAgentOperation, sessionLaunchAgentInMountOperation])(
  '$id managed intent wire',
  operation => {
    const base =
      operation.id === 'session.launchAgent'
        ? { cwd: '/repo', prompt: '' }
        : { mountId: 'mount', prompt: '' }
    function invoke(intent: unknown, mirrors = {}) {
      const surface = createControlSurface()
      registerOperation(surface, operation as typeof sessionLaunchAgentOperation, {
        defaultErrorCode: 'common.invalid_input',
        handle: async (_ctx, payload) => payload,
      })
      return surface.invoke(context, {
        kind: 'command',
        id: operation.id,
        payload: { ...base, intent, ...mirrors },
      })
    }
    it('accepts intent-only requests without treating defaults as contradictory mirrors', async () => {
      const intent = { kind: 'resumeConversation', resumeSessionId: 'target', expected }
      expect(await invoke(intent)).toMatchObject({
        ok: true,
        value: { intent, mode: 'resume', resumeSessionId: 'target' },
      })
    })
    it.each([
      { kind: 'unexpected' },
      { kind: 'resumeCurrent', extra: true },
      { kind: 'launchNew', expected: { ...expected, extra: true } },
      { kind: 'launchNew', expected: { ...expected, tuple: { ...expected.tuple, extra: true } } },
      {
        kind: 'launchNew',
        expected: {
          ...expected,
          tuple: { resumeSessionId: null, resumeSessionIdVerified: 'false' },
        },
      },
      { kind: 'resumeConversation', resumeSessionId: ' ', expected },
      { kind: 'launchNew' },
    ])('rejects malformed intent %j before handler effects', async intent => {
      expect(await invoke(intent)).toMatchObject({
        ok: false,
        error: { code: 'common.invalid_input' },
      })
    })
    it('rejects only explicit contradictory legacy mirrors', async () => {
      const intent = { kind: 'resumeConversation', resumeSessionId: 'target', expected }
      expect(await invoke(intent, { mode: 'new' })).toMatchObject({ ok: false })
      expect(await invoke(intent, { resumeSessionId: 'different' })).toMatchObject({ ok: false })
      expect(await invoke(intent, { mode: 'resume', resumeSessionId: 'target' })).toMatchObject({
        ok: true,
      })
    })
  },
)
