// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearStateProjectionFixture } from './claudeClearStateProjection.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

it.each(
  ['delivery', 'human'].flatMap(writer =>
    [false, true].map(delayedEnd => ({ writer, delayedEnd })),
  ),
)(
  'keeps a swallowed Enter in its namespace: writer=$writer, delayed End=$delayedEnd',
  async ({ writer, delayedEnd }) => {
    const f = await clearStateProjectionFixture()
    try {
      await f.startB()
      expect(f.fence().claudeClearReady).toBe(true)
      const enterAt = Date.now() + 300
      if (writer === 'delivery') {
        const pending = f.service
          .deliver({
            nodeId: 'n',
            text: 'SWALLOWED',
            whenBusy: 'refuse',
            timeoutMs: 500,
            deliveryId: 'swallowed-B',
          })
          .catch(error => error)
        await vi.advanceTimersByTimeAsync(1001)
        expect(await pending).toMatchObject({
          code: 'agent.prompt_stalled',
          details: { pasteDispatchAttempted: true, submitDispatchAttempted: true },
        })
        expect(f.write.mock.calls.map(call => call[1])).toEqual([
          '\x1b[200~SWALLOWED\x1b[201~',
          '\r',
        ])
        expect(f.write.mock.calls[1][3]).toEqual({
          providerSessionId: f.trace.b,
          invocationId: 's',
          conversationGeneration: f.fence().conversationGeneration,
        })
      } else {
        vi.setSystemTime(enterAt)
        f.controller.noteInteraction('s', '\r')
      }
      // Same-conversation Enter always revokes input, regardless of who owns it.
      expect(f.fence().claudeClearReady).toBe(false)
      expect(
        promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
      ).not.toBeNull()
      const ended = f.fence().snapshot.lastEndedTurn
      const before = f.write.mock.calls.length
      if (delayedEnd) {
        // The owned projection remains B's even if its relay timestamp is after End(B).
        await f.hook(f.trace.b, 'SessionEnd', enterAt - 1, { reason: 'clear' }, Date.now())
      }
      // Exact opaque-surface fixture order for the lost-End case: Start(C), late Stop(B).
      await f.startClear('C', Date.now() + 1, delayedEnd ? undefined : f.trace.b)
      const fence = f.fence()
      const delivery = await f.probe()
      expect({
        ready: fence.claudeClearReady,
        quarantined: fence.conversationQuarantined,
        writes: delivery.writes - before,
      }).toEqual(
        writer === 'delivery'
          ? { ready: true, quarantined: false, writes: 2 }
          : { ready: false, quarantined: true, writes: 0 },
      )
      expect(fence.snapshot.lastEndedTurn).toEqual(ended)
      expect(f.registry.promptIdentity(fence)?.providerSessionId).toBe('C')
      if (writer === 'human') {
        await f.hook('C', 'UserPromptSubmit', Date.now() + 1, { prompt_id: 'C-turn' })
        await f.hook('C', 'Stop', Date.now() + 1, {
          prompt_id: 'C-turn',
          last_assistant_message: 'C',
        })
        expect(f.fence().conversationQuarantined).toBe(false)
      } else {
        // Repeat the next opaque iteration with another swallowed, owned Enter.
        await f.startClear('D', Date.now() + 1, 'C')
        expect(f.fence()).toMatchObject({ claudeClearReady: true, conversationQuarantined: false })
      }
    } finally {
      await f.close()
    }
  },
)
