// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import { capacityAttempt } from './claudeClearCapacity.helpers'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'

async function receipts(end: boolean, replay: boolean) {
  const archive = new InMemoryAgentTurnArchive({ now: () => Date.now() })
  const append = vi.spyOn(archive, 'append')
  const f = await clearIngressFixture(false, false, archive)
  const events: unknown[] = [],
    contextual: unknown[] = []
  const cursor = f.registry.watermark()
  f.registry.subscribe({ epoch: cursor.epoch, afterSeq: cursor.seq }, {}, e => events.push(e))
  f.registry.subscribeContextual({ epoch: cursor.epoch, afterSeq: cursor.seq }, e =>
    contextual.push(e),
  )
  await f.send('B', 'SessionStart', 20, undefined, 'clear')
  if (end) {
    await f.send('B', 'SessionEnd', 30)
  }
  await vi.advanceTimersByTimeAsync(201)
  await f.send('C', 'SessionStart', 100, undefined, 'clear')
  await vi.advanceTimersByTimeAsync(201)
  await f.send('B', 'UserPromptSubmit', 450, 'old')
  await f.send('B', 'Stop', 500, 'old')
  for (let n = 0; n < 70; n++) {
    // oxlint-disable-next-line no-await-in-loop -- authenticated independent clear boundaries
    await f.send(`L${n}`, 'SessionStart', 150 + n, undefined, 'clear')
    // oxlint-disable-next-line no-await-in-loop -- exercise compaction across quiet windows
    await vi.advanceTimersByTimeAsync(201)
  }
  await f.send('B', 'SessionStart', 400, undefined, 'clear')
  const read = (turnId: string) => {
    try {
      return f.registry.finalMessage({ nodeId: 'n', turnId })
    } catch (error) {
      return {
        code: (error as { code: string }).code,
        details: (error as { details: unknown }).details,
      }
    }
  }
  const view = () => ({
    watermark: f.registry.watermark(),
    snapshot: f.fence().snapshot,
    events: structuredClone(events),
    contextual: structuredClone(contextual),
    archive: structuredClone(append.mock.calls),
    exact: archive.getExact({ nodeId: 'n', turnId: 'turn' }),
    extra: archive.getExact({ nodeId: 'n', turnId: 'turn-2' }),
    history: [read('turn'), read('turn-2')],
  })
  if (replay) {
    await f.send('B', 'UserPromptSubmit', 450, 'old')
    await f.send('B', 'Stop', 500, 'old')
  }
  expect(f.fence().claudeHistorySaturated).not.toBe(true)
  const before = view()
  await vi.advanceTimersByTimeAsync(201)
  const after = view()
  const delivery = await capacityAttempt(f)
  await f.close()
  return { before, after, delivery }
}
it('rejects receipts first observed after their End even when the ID later returns', async () => {
  const value = await receipts(true, true)
  expect(value.delivery.writes).toBe(0)
  expect(value.after.snapshot.lastEndedTurn?.id).toBe('turn')
  expect(value.after.extra).toEqual({ status: 'absent' })
})
it.each([false, true])('publishes no receipt replay inside a clear window, ended=%s', async end => {
  const control = await receipts(end, false)
  const replay = await receipts(end, true)
  expect(replay.before).toEqual(control.before)
  expect(replay.after).toEqual(control.after)
  expect(replay.delivery.writes).toBe(0)
})
