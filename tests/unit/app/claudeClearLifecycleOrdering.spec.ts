// @vitest-environment node
import { expect, it } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'

type Hook = 'Start' | 'Submit' | 'Stop' | 'End' | 'Passive'
const stamps = { Start: 10, Submit: 20, Stop: 25, End: 30, Passive: 40 }
const names = {
  Start: 'SessionStart',
  Submit: 'UserPromptSubmit',
  Stop: 'Stop',
  End: 'SessionEnd',
  Passive: 'Notification',
}
function permutations<T>(values: T[]): T[][] {
  return values.length
    ? values.flatMap((value, index) =>
        permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]),
      )
    : [[]]
}
// Exhaust delayed-Start buffer permutations, with every passive-notification placement.
// Once the buffer is released, the remaining live suffix follows provider relay order.
const cases = [false, true]
  .flatMap(stop => {
    const activity: Hook[] = stop ? ['Submit', 'Stop', 'End'] : ['Submit', 'End']
    return Array.from({ length: activity.length + 1 }, (_, count) => count).flatMap(count =>
      permutations(activity.slice(0, count)).flatMap(prefix => {
        const sequence: Hook[] = [...prefix, 'Start', ...activity.slice(count)]
        return Array.from({ length: sequence.length + 1 }, (_, index) => ({
          stop,
          order: [...sequence.slice(0, index), 'Passive', ...sequence.slice(index)] as Hook[],
        }))
      }),
    )
  })
  .map(value => ({
    ...value,
    label: `${value.stop ? 'Stop+End' : 'End'}: ${value.order.join('→')}`,
  }))
async function finalView(order: Hook[]) {
  const f = await clearIngressFixture(false)
  const completed: unknown[] = []
  f.registry.subscribe(
    { epoch: 'worker', afterSeq: f.registry.list().seq },
    { types: ['agent.turn_completed'] },
    event => completed.push(event),
  )
  try {
    for (const hook of order) {
      // oxlint-disable-next-line no-await-in-loop -- permutation arrival order is the property
      await f.send(
        'B',
        names[hook],
        stamps[hook],
        ['Submit', 'Stop'].includes(hook) ? 'b' : undefined,
        hook === 'Start' ? 'clear' : undefined,
        hook === 'Passive' ? { notification_type: 'idle_prompt' } : {},
      )
    }
    await f.settle()
    const fence = f.fence()
    expect(fence.snapshot.turn).toBeNull()
    expect(fence.snapshot.lastEndedTurn?.id).toBe('turn-2')
    expect(completed).toHaveLength(1)
    let read: unknown
    try {
      read = f.registry.finalMessage({ nodeId: 'n', turnId: 'turn-2' })
    } catch (error) {
      const failure = error as { code: string; details: { reason: string } }
      expect(failure.details.reason).not.toBe('turn_not_ended')
      read = { code: failure.code, details: failure.details }
    }
    return {
      snapshot: fence.snapshot,
      ready: fence.claudeClearReady,
      quarantined: fence.conversationQuarantined,
      lastTurnEnd: fence.lastTurnEnd,
      read,
    }
  } finally {
    await f.close()
  }
}
it.each(cases)('converges delayed-Start lifecycle $label', async ({ stop, order }) => {
  const canonical: Hook[] = stop
    ? ['Start', 'Submit', 'Stop', 'End', 'Passive']
    : ['Start', 'Submit', 'End', 'Passive']
  expect(await finalView(order)).toEqual(await finalView(canonical))
})
