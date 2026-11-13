import type { ClearCase, ClearEvent } from './cases'
import { capacityCases } from './capacity'
/** Copies preserve the exact source record, capture slot, prompt and relay timestamp. */
export function replayCases(seed: number): ClearCase[] {
  let state = seed >>> 0
  const random = (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 8) % n
  }
  const hook = (epoch: number, id: string, name: string, at: number): ClearEvent => ({
    epoch,
    id,
    kind: 'hook',
    name,
    at,
  })
  const quiet = (): ClearEvent => ({ epoch: 1, id: 'B', kind: 'tick', at: 0, ms: 201 })
  const result = capacityCases(seed).map(value => {
    const events = [...value.events]
    const sources = events.filter(e => e.kind !== 'tick' && e.kind !== 'capture')
    // Replay arbitrary old IO and hooks after compaction/saturation, not only adjacent duplicates.
    for (let i = 0; i < 12; i++) {
      const source = sources[random(sources.length)]
      const first = events.indexOf(source)
      const later = first + 1 + random(events.length - first)
      events.splice(later, 0, { ...source, duplicate: true })
    }
    events.push(...sources.slice(-3).map(e => ({ ...e, duplicate: true })), quiet())
    return { ...value, events, equivalent: false }
  })
  for (const count of [10, 70]) {
    const events = [hook(1, 'B', 'SessionStart', 20), quiet(), hook(1, 'B', 'Stop', 500)]
    for (let n = 0; n < count; n++) {
      events.push(hook(10 + n, `L${n}`, 'SessionStart', 100 + n), quiet())
    }
    events.push(
      hook(2, 'B', 'SessionStart', 400),
      quiet(),
      { ...events[2], duplicate: true },
      quiet(),
    )
    result.push({ seed, index: result.length, ids: ['A', 'B'], events, equivalent: false })
  }
  // Rejected receipts must enter provenance before ordinary routing discards them.
  for (const count of [10, 70, 260, 520]) {
    const at = count > 70 ? 2000 : 400
    const submit = hook(3, 'B', 'UserPromptSubmit', at + 50),
      stop = hook(3, 'B', 'Stop', at + 100)
    const events = [
      hook(1, 'B', 'SessionStart', 20),
      quiet(),
      hook(2, 'C', 'SessionStart', 100),
      quiet(),
      submit,
      stop,
    ]
    for (let n = 0; n < count; n++) {
      events.push(hook(10 + n, `L${n}`, 'SessionStart', 150 + n), quiet())
    }
    events.push(
      hook(3, 'B', 'SessionStart', at),
      quiet(),
      { ...submit, duplicate: true },
      { ...stop, duplicate: true },
      quiet(),
    )
    result.push({ seed, index: result.length, ids: ['A', 'B', 'C'], events, equivalent: false })
  }
  // More than twice the 1,024 exact provenance entries. Missing origins cannot become fresh.
  const saturated: ClearEvent[] = []
  for (let n = 0; n < 1025; n++) {
    saturated.push(
      hook(10000 + n, 'A', 'UserPromptSubmit', 20 + n * 2),
      hook(10000 + n, 'A', 'Stop', 21 + n * 2),
    )
  }
  saturated.push(
    hook(1, 'B', 'SessionStart', 3000),
    quiet(),
    hook(1, 'B', 'UserPromptSubmit', 3010),
    hook(1, 'B', 'Stop', 3020),
    { ...saturated[1], duplicate: true },
    quiet(),
  )
  result.push({ seed, index: result.length, ids: ['A', 'B'], events: saturated, equivalent: false })
  return result.map((value, index) => ({ ...value, index: 10000 + index }))
}
