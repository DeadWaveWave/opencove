export const CLEAR_SEEDS = [0xb4800001, 0xb4800101, 0xb4800201, 0xb4800301, 0xb4800401]
export type ClearEvent = {
  epoch: number
  id: string
  at: number
  kind: 'hook' | 'file' | 'metadata' | 'user' | 'tick' | 'capture'
  name?: string
  ms?: number
  duplicate?: boolean
}
export type ClearCase = {
  seed: number
  index: number
  ids: string[]
  events: ClearEvent[]
  equivalent: boolean
}
export function clearCases(seed: number): ClearCase[] {
  let state = seed >>> 0
  const random = (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 8) % n
  }
  const shuffle = <T>(items: T[]) => {
    for (let n = items.length - 1; n; n--) {
      const at = random(n + 1)
      ;[items[n], items[at]] = [items[at], items[n]]
    }
    return items
  }
  return Array.from({ length: 1000 }, (_, index) => {
    const count = 1 + random(3),
      ids = ['A', random(4) === 0 ? 'A' : 'B']
    for (let epoch = 2; epoch <= count; epoch++) {
      ids.push(random(4) === 0 ? ids[epoch - 1] : String.fromCharCode(65 + epoch))
    }
    const groups = ids.map((id, epoch) => {
      const base = epoch * 100
      const names = [
        'SessionStart',
        'UserPromptSubmit',
        'PermissionRequest',
        'Notification',
        'Stop',
        'SessionEnd',
      ]
      const events: ClearEvent[] = names.map((name, n) => ({
        epoch,
        id,
        kind: 'hook',
        name,
        at: base + [10, 20, 30, 35, 70, 90][n],
      }))
      for (const [n, name] of ['working', 'waiting', 'idle'].entries()) {
        events.push({ epoch, id, kind: 'file', name, at: base + 40 + n * 10 })
      }
      events.push(
        { epoch, id, kind: 'metadata', at: base + 15 },
        { epoch, id, kind: 'user', at: base + 25 },
      )
      return events
    })
    // Equality cases retain A's completed history; safety cases shuffle every conversation.
    let events: ClearEvent[]
    const equivalent = index % 4 === 0
    if (equivalent) {
      events = groups[0].filter(e => e.name !== 'SessionEnd')
      for (let epoch = 1; epoch < groups.length; epoch++) {
        // Reused wire IDs do not distinguish epochs before their Start. Equivalence cases keep
        // that causal boundary; the unrestricted cases still reorder same-ID activity freely.
        const transition = [
          groups[epoch - 1].find(e => e.name === 'SessionEnd')!,
          ...groups[epoch].filter(e => epoch === groups.length - 1 || e.name !== 'SessionEnd'),
        ]
        const group =
          ids[epoch] === ids[epoch - 1]
            ? [groups[epoch][0], ...shuffle(transition.filter(e => e !== groups[epoch][0]))]
            : shuffle(transition)
        events.push(...group, {
          kind: 'tick',
          epoch,
          id: ids[epoch],
          at: epoch * 100 + 99,
          ms: 201,
        })
      }
    } else {
      events = shuffle(groups.flat())
      // Explicit early-successor challenge, before BOTH lifecycle hooks, in addition to the
      // unconstrained shuffle. Settling here exposes discarded activity before later Stop/End.
      if (index % 3 === 0) {
        const epoch = index % 2 === 0 ? 1 : 1 + random(count)
        const choices = groups[epoch].filter(
          e =>
            ['UserPromptSubmit', 'PermissionRequest', 'working', 'waiting'].includes(
              e.name ?? '',
            ) ||
            e.kind === 'user' ||
            e.kind === 'metadata',
        )
        const target = choices[random(choices.length)]
        const end = groups[epoch - 1].find(e => e.name === 'SessionEnd')!,
          start = groups[epoch][0]
        events = [
          target,
          end,
          start,
          { kind: 'tick', id: ids[epoch], epoch, at: epoch * 100 + 99, ms: 201 },
          ...events.filter(e => e !== target && e !== end && e !== start),
        ]
      }
      if (index % 5 === 1) {
        // Capture before BOTH first-clear hooks, then deliver IO while End is pending.
        const kind = ['working', 'waiting', 'idle', 'metadata', 'user'][random(5)]
        const target = groups[1].find(e => e.name === kind || e.kind === kind)!
        const end = groups[0].find(e => e.name === 'SessionEnd')!,
          start = groups[1][0]
        events = [
          { kind: 'capture', epoch: 1, id: ids[1], at: 80 },
          end,
          target,
          start,
          { kind: 'tick', epoch: 1, id: ids[1], at: 199, ms: 201 },
          ...events.filter(e => e !== end && e !== start && e !== target),
        ]
      }
      if (index % 5 === 2) {
        const kind = ['working', 'waiting', 'user'][random(3)]
        const target = groups[1].find(e => e.name === kind || e.kind === kind)!
        const end = groups[0].find(e => e.name === 'SessionEnd')!,
          start = groups[1][0]
        events = [
          { kind: 'capture', epoch: 1, id: ids[1], at: 80 },
          end,
          start,
          { kind: 'tick', epoch: 1, id: ids[1], at: 199, ms: 201 },
          target,
          ...events.filter(e => e !== end && e !== start && e !== target),
        ]
      }
      const copies = 1 + random(5)
      for (let n = 0; n < copies; n++) {
        const event = events[random(events.length)]
        events.splice(random(events.length + 1), 0, { ...event, duplicate: true })
      }
      if (index % 7 === 0) {
        events.splice(random(events.length + 1), 0, {
          kind: 'tick',
          id: ids.at(-1)!,
          epoch: count,
          at: 999,
          ms: 2100,
        })
      }
    }
    return { seed, index, ids, events, equivalent }
  })
}
/** 1-minimal deletion reproducer; relay stamps, identities and prefix stay unchanged. */
export async function minimizeClearCase(
  value: ClearCase,
  fails: (value: ClearCase) => Promise<boolean>,
) {
  let result = value,
    width = Math.max(1, Math.floor(value.events.length / 2))
  while (width >= 1) {
    let changed = false
    for (let at = 0; at < result.events.length; at++) {
      const candidate = {
        ...result,
        events: result.events.filter((_, n) => n < at || n >= at + width),
      }
      // oxlint-disable-next-line no-await-in-loop -- deletion depends on the previous shrink
      if (await fails(candidate)) {
        result = candidate
        changed = true
        break
      }
    }
    if (!changed) {
      width = Math.floor(width / 2)
    }
  }
  return result
}
export { capacityCases } from './capacity'

export { replayCases } from './replay'
