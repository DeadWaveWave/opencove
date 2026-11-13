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
    for (let turn = 0; turn < 256 + n; turn++) {
      ordinary.push(
        hook(1000 + turn, 'A', 'UserPromptSubmit', 20 + turn * 2),
        hook(1000 + turn, 'A', 'Stop', 21 + turn * 2),
      )
    }
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
      const captureCount = active && n === 0 ? 1280 : 128 + n
      for (let i = 0; i < captureCount; i++) {
        captures.push({ epoch: 1000 + i, id: `U${i}`, kind: 'capture', at: 120 + i })
      }
      if (active) {
        for (let i = 0; i < captureCount; i++) {
          captures.push({
            epoch: 1000 + i,
            id: `U${i}`,
            kind: 'file',
            name: random(2) ? 'working' : 'waiting',
            at: 500 + i,
          })
        }
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
    if (random(2)) {
      ties.reverse()
    }
    const tied: ClearEvent[] = [...ties, hook(1, 'B', 'Notification', 110), quiet()]
    if (n % 2 === 0) {
      tied.push(hook(3, 'D', 'SessionStart', 310), quiet('D', 3))
    }
    const lifecycle: ClearEvent[] = [hook(0, 'A', 'UserPromptSubmit', 20), hook(0, 'A', 'Stop', 30)]
    for (let i = 0; i < 520 + n; i++) {
      const id = `L${i}`
      if (n % 2 === 0) {
        lifecycle.push(
          hook(i === 0 ? 0 : 100 + i - 1, i === 0 ? 'A' : `L${i - 1}`, 'SessionEnd', 99 + i * 4),
        )
      }
      lifecycle.push(hook(100 + i, id, 'SessionStart', 100 + i * 4), quiet(id, 100 + i))
    }
    const reuse = [...lifecycle, hook(5000, 'A', 'SessionStart', 5000), quiet('A', 5000)]
    if (n % 2 === 0) {
      reuse.push(
        hook(5000, 'A', 'UserPromptSubmit', 5010),
        hook(5000, 'A', 'Stop', 5020),
        quiet('A', 5000),
      )
    }
    const dependent = [
      hook(1, 'B', 'SessionStart', 20),
      hook(1, 'B', 'SessionEnd', 30),
      hook(2, 'B', 'UserPromptSubmit', 50),
      hook(3, 'C', 'SessionStart', 40),
      quiet('C', 3),
    ]
    for (let i = 0; i < 635 + n; i++) {
      dependent.push(hook(3, 'C', 'PermissionRequest', 60 + i))
    }
    dependent.push(hook(3, 'C', 'Stop', 1000), quiet('C', 3))
    result.push(
      ...[
        ordinary,
        flood,
        [...start(), ...receipts, quiet()],
        tied,
        ...(n < 2 ? [lifecycle, reuse] : []),
        dependent,
      ].map(events => ({
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
