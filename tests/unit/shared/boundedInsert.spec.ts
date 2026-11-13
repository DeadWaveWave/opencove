import { expect, it, vi } from 'vitest'
import { boundedInsert } from '../../../src/shared/utils/boundedInsert'
it('refuses overflow before a mutation and invokes the owner veto once per attempt', () => {
  const values: number[] = [],
    overflow = vi.fn()
  for (let i = 0; i < 4; i++) {
    expect(boundedInsert(values.length, 2, () => values.push(i), overflow)).toBe(i < 2)
    expect(values.length).toBeLessThanOrEqual(2)
  }
  expect(values).toEqual([0, 1])
  expect(overflow).toHaveBeenCalledTimes(2)
  expect(boundedInsert(0, 0, () => values.push(9), overflow)).toBe(false)
  expect(values).toEqual([0, 1])
})
