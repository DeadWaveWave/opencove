import { describe, expect, it } from 'vitest'
import { resolveWaitDuration } from './waitDuration'

describe('resolveWaitDuration', () => {
  it('says nothing about time it did not observe', () => {
    expect(resolveWaitDuration(null, 10_000)).toEqual({ unit: 'unknown' })
  })

  it('steps from now to minutes to hours', () => {
    expect(resolveWaitDuration(0, 59_000)).toEqual({ unit: 'now' })
    expect(resolveWaitDuration(0, 2 * 60_000 + 5_000)).toEqual({ unit: 'minutes', count: 2 })
    expect(resolveWaitDuration(0, 59 * 60_000)).toEqual({ unit: 'minutes', count: 59 })
    expect(resolveWaitDuration(0, 125 * 60_000)).toEqual({ unit: 'hours', count: 2 })
  })

  it('treats a clock that moved backwards as now', () => {
    expect(resolveWaitDuration(10_000, 5_000)).toEqual({ unit: 'now' })
  })
})
