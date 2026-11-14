import { expect, it } from 'vitest'
import { ClaudeCaptureBindings } from '../../../src/contexts/agent/application/ClaudeCaptureBindings'
it('evicts only a retired indexed binding without reviving a held token', () => {
  const b = new ClaudeCaptureBindings()
  b.start('A', 10)
  const a = b.capture('A')
  b.start('B', 20)
  for (let n = 0; n < 128; n++) {
    b.capture(`U${n}`)
  }
  expect(a.retired).toBe(true)
  expect(b.capture('B').startAt).toBe(20)
  expect((b as unknown as { current: Map<string, object> }).current.size).toBeLessThanOrEqual(64)
})
it('preserves observed capabilities when their pending index cannot fit', () => {
  const b = new ClaudeCaptureBindings()
  for (let n = 0; n < 64; n++) {
    b.capture(`U${n}`)
  }
  const held = b.capture('B')
  expect(held.startAt).toBeUndefined()
  b.start('B', 20, [held])
  expect(held).toMatchObject({ startAt: 20, retired: false })
  b.end('B', 30, [held])
  expect(held.retired).toBe(true)
})
it('retires an unindexed observed source on replacement and preserves a later same-ID epoch', () => {
  const b = new ClaudeCaptureBindings()
  for (let n = 0; n < 64; n++) {
    b.capture(`U${n}`)
  }
  const old = b.capture('B')
  b.start('B', 20, [old])
  b.start('B', 40, [old])
  expect(old.retired).toBe(true)
  const current = b.capture('B', 40)
  b.start('B', 30, [old, current])
  expect(current.retired).toBe(false)
})
it('does not retire an unbound pending source on an earlier End', () => {
  const b = new ClaudeCaptureBindings(),
    pending = b.capture('B')
  b.end('B', 19, [pending])
  expect(pending.retired).toBe(false)
  b.start('B', 20, [pending])
  b.end('B', 19, [pending])
  expect(pending.retired).toBe(false)
})
it('disposes every capability including ones outside the bounded index', () => {
  const b = new ClaudeCaptureBindings()
  for (let n = 0; n < 64; n++) {
    b.capture(`U${n}`)
  }
  const held = b.capture('B')
  b.dispose()
  expect(b.owns(held)).toBe(false)
  expect(b.capture('B').retired).toBe(true)
})
