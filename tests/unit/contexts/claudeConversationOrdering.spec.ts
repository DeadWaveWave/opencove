import { afterEach, expect, it, vi } from 'vitest'
import {
  hook,
  orderingFixture,
  permutations,
  type Evidence,
} from './claudeConversationOrdering.helpers'

const B = (name: string, at: number) => hook('B', name, at)
type Scenario = {
  name: string
  events: Evidence[]
  prefix?: Evidence[]
  provider: string
  outcomes: string[]
  archiveProviders: string[]
}
export const scenarios: Scenario[] = [
  {
    name: 'retired A clear and Stop',
    prefix: [B('SessionStart', 10)],
    events: [
      B('UserPromptSubmit', 20),
      B('Stop', 25),
      hook('A', 'SessionStart', 30),
      hook('A', 'Stop', 35),
    ],
    provider: 'B',
    outcomes: ['completed'],
    archiveProviders: ['B'],
  },
  {
    name: 'same-ID clear',
    events: [
      B('SessionStart', 10),
      B('UserPromptSubmit', 12),
      B('Stop', 15),
      B('SessionStart', 20),
    ],
    provider: 'B',
    outcomes: ['completed'],
    archiveProviders: ['B'],
  },
  {
    name: 'successor replaces pending End',
    events: [
      B('SessionStart', 10),
      B('UserPromptSubmit', 20),
      B('Stop', 25),
      B('SessionEnd', 30),
      hook('C', 'SessionStart', 40),
    ],
    provider: 'C',
    outcomes: ['completed'],
    archiveProviders: ['B'],
  },
  {
    name: 'A completes then first B prompt',
    prefix: [hook('A', 'UserPromptSubmit', 2), hook('A', 'Stop', 3)],
    events: [
      { ...hook('A', 'SessionEnd', 5), sessionEndReason: 'clear' },
      B('SessionStart', 10),
      B('UserPromptSubmit', 20),
      B('Stop', 25),
    ],
    provider: 'B',
    outcomes: ['completed', 'completed'],
    archiveProviders: ['A', 'B'],
  },
  {
    name: 'B prompt Stop End passive notification',
    events: [
      B('SessionStart', 10),
      B('UserPromptSubmit', 20),
      B('Stop', 25),
      B('SessionEnd', 30),
      B('Notification', 40),
    ],
    provider: 'B',
    outcomes: ['completed'],
    archiveProviders: ['B'],
  },
  {
    name: 'clear End',
    events: [B('SessionStart', 10), B('SessionEnd', 30)],
    provider: 'B',
    outcomes: [],
    archiveProviders: [],
  },
  {
    name: 'repeated clears',
    events: [
      B('SessionStart', 10),
      B('UserPromptSubmit', 12),
      B('Stop', 15),
      hook('C', 'SessionStart', 20),
      hook('D', 'SessionStart', 30),
    ],
    provider: 'D',
    outcomes: ['completed'],
    archiveProviders: ['B'],
  },
  {
    name: 'passive notification',
    events: [
      B('SessionStart', 10),
      B('UserPromptSubmit', 20),
      B('Notification', 22),
      B('Stop', 25),
    ],
    provider: 'B',
    outcomes: ['completed'],
    archiveProviders: ['B'],
  },
  {
    name: 'stale A watcher callbacks',
    events: [
      B('SessionStart', 10),
      ...(['record', 'state', 'error'] as const).map((watcher, i) => ({
        ...hook('A', 'watcher', 20 + i),
        watcher,
      })),
    ],
    provider: 'B',
    outcomes: [],
    archiveProviders: [],
  },
  {
    name: 'B prompt End without Stop',
    events: [
      B('SessionStart', 10),
      B('UserPromptSubmit', 20),
      B('SessionEnd', 30),
      B('Notification', 40),
    ],
    provider: 'B',
    outcomes: ['unknown'],
    archiveProviders: ['B'],
  },
]
afterEach(() => vi.useRealTimers())
function replay(events: Evidence[], prefix: Evidence[] = []) {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture(),
    seen: Evidence[] = [...prefix]
  const assertAuthority = () => {
    if (!f.fence().claudeClearReady) {
      return
    }
    const newest = seen
      .filter(e => e.hookEventName === 'SessionStart')
      .sort((a, b) => b.emittedAtMs! - a.emittedAtMs!)[0]
    expect(f.registry.promptIdentity(f.fence())?.providerSessionId).toBe(newest?.claudeSessionId)
    expect(
      seen.some(
        e =>
          e.claudeSessionId === newest?.claudeSessionId &&
          e.state &&
          e.emittedAtMs! > newest.emittedAtMs!,
      ),
    ).toBe(false)
  }
  const authorityErrors: unknown[] = []
  // The registry isolates subscriber exceptions, so explicitly collect failures from every publication.
  f.registry.subscribe({ epoch: 'e', afterSeq: f.registry.list().seq }, {}, () => {
    try {
      assertAuthority()
    } catch (error) {
      authorityErrors.push(error)
    }
  })
  try {
    for (const event of prefix) {
      f.send(event)
    }
    // Full bypass begins reconciliation only after authenticated clear evidence, never a future clear.
    if (!prefix.some(e => e.sessionStartSource === 'clear' || e.sessionEndReason === 'clear')) {
      f.send({ ...hook('A', 'SessionEnd', 4), sessionEndReason: 'clear' })
    }
    for (const event of events) {
      seen.push(event)
      f.send(event)
      assertAuthority()
    }
    vi.advanceTimersByTime(2000)
    assertAuthority()
    expect(authorityErrors).toEqual([])
    // Early completion and quiet settlement intentionally have different commit clocks.
    return JSON.parse(
      JSON.stringify(f.view(), (key, value) =>
        [
          'endedAt',
          'archivedAt',
          'startedAt',
          'lastActivityAt',
          'lastTransitionAt',
          'observedAt',
        ].includes(key)
          ? undefined
          : value,
      ),
    ) as ReturnType<typeof f.view>
  } finally {
    f.registry.dispose()
  }
}
it('converges every arrival order while clear End is already pending (24)', () => {
  const events = [
    B('UserPromptSubmit', 20),
    B('Stop', 25),
    B('SessionEnd', 30),
    B('Notification', 40),
  ]
  const canonical = replay(events, [
    { ...hook('A', 'SessionEnd', 5), sessionEndReason: 'clear' },
    B('SessionStart', 10),
  ])
  expect(canonical.archive).toMatchObject([
    { turnId: 't1', outcome: 'completed', message: 'reply-B', providerSessionId: 'B' },
  ])
  let failures = 0,
    first: unknown
  for (const order of permutations(events)) {
    try {
      expect(
        replay(order, [
          { ...hook('A', 'SessionEnd', 5), sessionEndReason: 'clear' },
          B('SessionStart', 10),
        ]),
      ).toEqual(canonical)
    } catch (error) {
      first ??= { order, error: String(error) }
      failures++
    }
  }
  expect(failures, JSON.stringify(first, null, 2)).toBe(0)
})
for (const scenario of scenarios) {
  it(`converges every arrival order: ${scenario.name} (${permutations(scenario.events).length})`, () => {
    const canonical = replay(scenario.events, scenario.prefix)
    expect(canonical.archive.map(r => r.outcome)).toEqual(scenario.outcomes)
    canonical.archive.forEach((record, i) => {
      expect(canonical.stored[i]).toMatchObject({
        status: 'found',
        record: {
          providerSessionId: record.providerSessionId,
          turnId: record.turnId,
          outcome: record.outcome,
        },
      })
      if (record.message !== null) {
        expect(canonical.exact[i]).toMatchObject({
          turnId: record.turnId,
          outcome: record.outcome,
          message: record.message,
        })
      }
    })
    let failures = 0,
      first: unknown
    for (const order of permutations(scenario.events)) {
      try {
        const actual = replay(order, scenario.prefix)
        if (actual.ready || actual.snapshot.turn) {
          expect(actual.identity).toBe(scenario.provider)
        }
        expect(actual.archive.map(record => record.providerSessionId)).toEqual(
          scenario.archiveProviders,
        )
        expect(actual).toEqual(canonical)
      } catch (error) {
        first ??= { order, error: String(error) }
        failures++
      }
    }
    expect(
      failures,
      `${scenario.name}: divergent permutations ${JSON.stringify(first, null, 2)}`,
    ).toBe(0)
  })
}
