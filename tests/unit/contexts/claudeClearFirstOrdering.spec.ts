// @vitest-environment node
import { expect, it } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { runClearCase } from '../../support/claudeClearProperty/run'
import type { ClearCase, ClearEvent } from '../../support/claudeClearProperty/cases'

function permutations<T>(items: T[]): T[][] {
  return items.length
    ? items.flatMap((item, n) =>
        permutations(items.filter((_, i) => i !== n)).map(rest => [item, ...rest]),
      )
    : [[]]
}
for (const [activity, completed] of [
  ['UserPromptSubmit', false],
  ['PermissionRequest', false],
  ['UserPromptSubmit', true],
] as const) {
  it(`folds all ${completed ? 24 : 6} first-clear arrival orders with ${activity}, completed=${completed}`, async () => {
    const prefix: ClearEvent[] = [
      { epoch: 0, id: 'A', kind: 'hook', name: 'UserPromptSubmit', at: 20 },
      { epoch: 0, id: 'A', kind: 'hook', name: 'Stop', at: 70 },
    ]
    const events: ClearEvent[] = [
      { epoch: 0, id: 'A', kind: 'hook', name: 'SessionEnd', at: 90 },
      { epoch: 1, id: 'B', kind: 'hook', name: 'SessionStart', at: 110 },
      { epoch: 1, id: 'B', kind: 'hook', name: activity, at: 130 },
    ]
    if (completed) {
      events.push({ epoch: 1, id: 'B', kind: 'hook', name: 'Stop', at: 170 })
    }
    const scenario: ClearCase = {
      seed: 0,
      index: 0,
      ids: ['A', 'B'],
      events: [...prefix, ...events],
      equivalent: true,
    }
    const expected = await runClearCase(scenario)
    expect(expected.errors).toEqual([])
    for (const order of permutations(events)) {
      // oxlint-disable-next-line no-await-in-loop -- each order owns an isolated registry
      const result = await runClearCase({ ...scenario, events: [...prefix, ...order] })
      expect(result.errors, JSON.stringify(order)).toEqual([])
      expect(
        isDeepStrictEqual(result.output, expected.output),
        JSON.stringify({ order, actual: result.output, expected: expected.output }),
      ).toBe(true)
    }
  })
}

it('publishes steady-state completion and early successor activity without scheduling clear reconciliation', async () => {
  const { clearPropertyRuntime } = await import('../../support/claudeClearProperty/runtime')
  const f = clearPropertyRuntime()
  try {
    f.dispatch({ epoch: 0, id: 'A', kind: 'hook', name: 'UserPromptSubmit', at: 20 })
    expect(f.fence().snapshot.state).toBe('working')
    expect([...f.tasks].every(task => task.at > 104020)).toBe(true)
    f.dispatch({ epoch: 0, id: 'A', kind: 'hook', name: 'Stop', at: 70 })
    expect(f.fence().snapshot).toMatchObject({
      state: 'idle',
      quality: 'authoritative',
      lastEndedTurn: { outcome: 'completed' },
    })
    expect(f.tasks.size).toBe(0)
    f.dispatch({ epoch: 1, id: 'B', kind: 'hook', name: 'UserPromptSubmit', at: 120 })
    expect(f.fence().snapshot.state).toBe('working')
    expect(f.fence().conversationGeneration).toBeUndefined()
    expect([...f.tasks].every(task => task.at > 104120)).toBe(true)
  } finally {
    f.dispose()
  }
})

it('revokes input atomically before adopting same-ID evidence and an unmatched later successor', async () => {
  const value: ClearCase = {
    seed: 0,
    index: 0,
    ids: ['A', 'A', 'C'],
    equivalent: false,
    events: [
      { epoch: 1, id: 'A', kind: 'hook', name: 'Stop', at: 170 },
      { epoch: 2, id: 'C', kind: 'hook', name: 'Stop', at: 270 },
      { epoch: 0, id: 'A', kind: 'hook', name: 'PermissionRequest', at: 30 },
      { epoch: 1, id: 'A', kind: 'hook', name: 'SessionStart', at: 110 },
    ],
  }
  expect((await runClearCase(value)).errors).toEqual([])
})
