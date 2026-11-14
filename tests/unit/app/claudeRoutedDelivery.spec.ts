// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { routedClaudeDeliveryFixture } from './claudeRoutedDelivery.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/opencove-user-data' },
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))
it.each(
  (['desktop', 'headless'] as const).flatMap(kind =>
    ['delivery', 'human'].flatMap(writer =>
      [false, true].map(firstClear => ({ kind, writer, firstClear })),
    ),
  ),
)(
  'preserves Enter ownership through $kind: $writer, first clear=$firstClear',
  async ({ kind, writer, firstClear }) => {
    const f = await routedClaudeDeliveryFixture(kind)
    try {
      const target = firstClear ? 'A' : 'B'
      const successor = firstClear ? 'B' : 'C'
      if (!firstClear) {
        await f.clear('B', 'A')
      }
      const initial = f.fence()
      expect(initial).toMatchObject({
        claudeClearReady: !firstClear,
        snapshot: { state: 'idle', quality: 'authoritative' },
      })
      if (firstClear) {
        // Ordinary history deliberately exposes only prompt identity after completion.
        expect(f.registry.promptIdentity(initial)?.providerSessionId).toBeUndefined()
        expect(f.registry.promptIdentity(initial)?.promptId).toBe('prompt-A')
      }
      const first = f.records.length
      if (writer === 'delivery') {
        expect(await f.deliver()).toMatchObject({
          code: 'agent.prompt_stalled',
          details: { pasteDispatchAttempted: true, submitDispatchAttempted: true },
        })
      } else {
        await f.routed.write('s', '\r')
      }
      // Both paths executed actual runtime.write and controller.noteInteraction, not a test publisher.
      expect(f.engine.write.mock.calls.filter(call => call[1] === '\r')).toHaveLength(1)
      const anonymous = f.records
        .slice(first)
        .filter(r => r.fileIdentity === 'unattributed-state' && r.activity)
      const evidence = getPromptSubmissionEvidence(
        f.states.findLast(s => s.source === 'session_file' && s.state === 'working')!,
      )
      expect(f.fence().claudeClearReady).toBe(false)
      if (!firstClear) {
        expect(
          promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
        ).not.toBeNull()
      }
      const ended = f.fence().snapshot.lastEndedTurn
      await f.clear(successor, target)
      if (writer === 'human') {
        await vi.advanceTimersByTimeAsync(10_000)
      }
      const writes = f.engine.write.mock.calls.length
      const ready = f.fence().claudeClearReady
      const result = await f.deliver()
      expect({
        ready,
        newWrites: f.engine.write.mock.calls.length - writes,
        anonymous: anonymous.length,
        observedTarget: evidence?.providerSessionId,
      }).toEqual(
        writer === 'delivery'
          ? { ready: true, newWrites: 2, anonymous: 0, observedTarget: target }
          : {
              ready: false,
              newWrites: 0,
              anonymous: firstClear ? 0 : 1,
              observedTarget: undefined,
            },
      )
      expect(f.fence().snapshot.lastEndedTurn).toEqual(ended)
      if (writer === 'human') {
        expect(result).toMatchObject({ code: 'agent.state_unknown' })
      } else {
        expect(result).toMatchObject({ code: 'agent.prompt_stalled' })
        await f.clear('D', successor)
        expect(f.fence().claudeClearReady).toBe(true)
      }
    } finally {
      await f.close()
    }
  },
)
