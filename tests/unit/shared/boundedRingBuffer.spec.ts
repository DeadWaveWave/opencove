import { describe, expect, it } from 'vitest'
import { BoundedRingBuffer } from '../../../src/shared/diagnostics/BoundedRingBuffer'

describe('BoundedRingBuffer', () => {
  it('drops the oldest entry after reaching its capacity', () => {
    const buffer = new BoundedRingBuffer<number>(3)

    buffer.push(1)
    buffer.push(2)
    buffer.push(3)
    buffer.push(4)

    expect(buffer.capacity).toBe(3)
    expect(buffer.snapshot()).toEqual([2, 3, 4])
  })

  it('returns a copy that cannot mutate retained entries', () => {
    const buffer = new BoundedRingBuffer<number>(2)
    buffer.push(1)

    const snapshot = buffer.snapshot()
    snapshot.push(2)

    expect(buffer.snapshot()).toEqual([1])
  })

  it('rejects invalid capacities', () => {
    expect(() => new BoundedRingBuffer(0)).toThrow(RangeError)
    expect(() => new BoundedRingBuffer(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
