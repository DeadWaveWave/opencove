import { describe, expect, it } from 'vitest'
import { canonicalContent, mergeValue } from '@shared/sync/mergeValue'

describe('mergeValue', () => {
  it.each([
    [2, 1, 1, 2],
    [1, 2, 1, 2],
    [2, 2, 1, 2],
    [2, 3, 1, 3],
    [{ a: 2 }, { a: 1, b: 2 }, { a: 1 }, { a: 2, b: 2 }],
    [{ a: 1 }, {}, { a: 1 }, {}],
    [[2], [3], [1], [3]],
    [{ a: 1 }, { b: 2 }, undefined, { b: 2 }],
  ])('merges %j / %j against %j', (latest, local, ancestor, result) => {
    expect(mergeValue<unknown>(latest, local, ancestor)).toEqual(result)
  })

  it('satisfies identities and key independence for seeded JSON values', () => {
    let seed = 7331
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
    const value = () => ({ n: next(), data: [next() % 3, null, String(next())] })
    for (let i = 0; i < 500; i++) {
      const a = value(),
        l = value(),
        r = value()
      expect(mergeValue(a, a, a)).toEqual(a)
      expect(mergeValue(l, a, a)).toEqual(l)
      expect(mergeValue(a, l, a)).toEqual(l)
      expect(mergeValue({ x: l, y: a }, { x: a, y: r }, { x: a, y: a })).toEqual({ x: l, y: r })
    }
  })
})

it('orders keys by code units regardless of locale and preserves prototype-named keys', () => {
  expect(canonicalContent(JSON.parse('{"ä":1,"z":2,"Z":3,"__proto__":4}'))).toBe(
    '{"Z":3,"__proto__":4,"z":2,"ä":1}',
  )
})
