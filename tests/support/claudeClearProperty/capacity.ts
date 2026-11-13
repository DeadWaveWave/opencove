import type { ClearCase, ClearEvent } from './cases'
/** Capacity challenges have completed ordinary prefixes intentionally: reordering those
 * prefixes changes main's non-clear history. Clear-side shuffles remain unrestricted elsewhere. */
export function capacityCases(seed: number): ClearCase[] {
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
  const quiet = (id = 'B', epoch = 1): ClearEvent => ({ epoch, id, kind: 'tick', at: 699, ms: 201 })
  const start = () => [hook(1, 'B', 'SessionStart', 110), quiet()]
  const result: ClearCase[] = []
  for (let n = 0; n < 5; n++) {
    const ordinary: ClearEvent[] = []
    for (let turn = 0; turn < 256 + n; turn++)
      ordinary.push(
        hook(1000 + turn, 'A', 'UserPromptSubmit', 20 + turn * 2),
        hook(1000 + turn, 'A', 'Stop', 21 + turn * 2),
      )
    ordinary.push(hook(0, 'A', 'SessionEnd', 590), hook(1, 'B', 'SessionStart', 600), quiet())
    const flood = start(),
      kind = ['working', 'waiting', 'user'][random(3)]
    flood.push({ epoch: 2, id: 'U', kind: kind === 'user' ? 'user' : 'file', name: kind, at: 140 })
    const receipts = Array.from({ length: 256 + n }, (_, i) => hook(1, 'B', 'Stop', 200 + i))
    for (let i = receipts.length - 1; i > 0; i--) {
      const at = random(i + 1)
      ;[receipts[i], receipts[at]] = [receipts[at], receipts[i]]
    }
    flood.push(...receipts, { epoch: 1, id: 'B', kind: 'metadata', at: 115 }, quiet())
    for (const active of [false, true]) {
      const captures = start()
      for (let i = 0; i < 128 + n; i++)
        captures.push({ epoch: 1000 + i, id: `U${i}`, kind: 'capture', at: 120 + i })
      if (active) {
        for (let i = 0; i < 128 + n; i++)
          captures.push({
            epoch: 1000 + i,
            id: `U${i}`,
            kind: 'file',
            name: random(2) ? 'working' : 'waiting',
            at: 500 + i,
          })
        captures.push(...Array.from({ length: 256 }, (_, i) => hook(1, 'B', 'Stop', 1000 + i)))
      }
      captures.push(quiet())
      result.push({
        seed,
        index: result.length,
        ids: ['A', 'B'],
        events: captures,
        equivalent: false,
      })
    }
    const ties = [hook(1, 'B', 'SessionStart', 110), hook(2, 'C', 'SessionStart', 110)]
    if (random(2)) ties.reverse()
    const tied: ClearEvent[] = [...ties, hook(1, 'B', 'Notification', 110), quiet()]
    if (n % 2 === 0) tied.push(hook(3, 'D', 'SessionStart', 310), quiet('D', 3))
    result.push(
      ...[ordinary, flood, [...start(), ...receipts, quiet()], tied].map(events => ({
        seed,
        index: result.length,
        ids: ['A', 'B'],
        events,
        equivalent: false,
      })),
    )
  }
  return result.map((value, index) => ({ ...value, index }))
}
