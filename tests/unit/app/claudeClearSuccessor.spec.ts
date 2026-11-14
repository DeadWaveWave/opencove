// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

it.each(['UserPromptSubmit', 'PermissionRequest'] as const)(
  'retains early successor %s before both clear lifecycle hooks',
  async activity => {
    const f = await clearIngressFixture(false)
    try {
      await f.send('B', 'SessionStart', 10, undefined, 'clear')
      await f.settle()
      const errors: string[] = []
      await f.send('C', activity, 30, 'c')
      if (!f.fence().conversationQuarantined) {
        errors.push('early activity: input not quarantined')
      }
      for (const [id, name, stamp, source, extra] of [
        ['B', 'SessionEnd', 19, undefined, { reason: 'clear' }],
        ['C', 'SessionStart', 20, 'clear', {}],
      ] as const) {
        // oxlint-disable-next-line no-await-in-loop -- the actual authenticated callback sequence
        await f.send(id, name, stamp, undefined, source, extra)
        if (
          !promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse')
        ) {
          errors.push(`${name}: admitted`)
        }
      }
      await vi.advanceTimersByTimeAsync(200)
      if (f.fence().claudeClearReady) {
        errors.push('successor receipt despite activity')
      }
      const pending = f.service
        .deliver({ nodeId: 'n', text: 'MUST_NOT_WRITE', whenBusy: 'refuse', timeoutMs: 1000 })
        .catch(error => error)
      // A broken readiness guard must expose both actual PTY writes, not just a mocked admission.
      await vi.advanceTimersByTimeAsync(1000)
      const result = await pending
      if (f.write.mock.calls.length) {
        errors.push(`delivery writes: ${f.write.mock.calls.length}`)
      }
      expect(errors).toEqual([])
      expect(result).toMatchObject({
        code: activity === 'PermissionRequest' ? 'agent.blocked' : 'agent.busy',
      })
      expect(f.fence().snapshot).toMatchObject({
        state: activity === 'PermissionRequest' ? 'waiting' : 'working',
      })
    } finally {
      await f.close()
    }
  },
)
