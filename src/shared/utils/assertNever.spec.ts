import { describe, expect, it } from 'vitest'
import { assertNever } from './assertNever'

type Shape = 'circle' | 'square'

function area(shape: Shape): number {
  switch (shape) {
    case 'circle':
      return 3
    case 'square':
      return 4
    default:
      return assertNever(shape)
  }
}

describe('assertNever', () => {
  it('lets an exhaustive switch compile and run', () => {
    expect(area('circle')).toBe(3)
    expect(area('square')).toBe(4)
  })

  it('throws with the offending value for an unexpected variant', () => {
    expect(() => assertNever('triangle' as never)).toThrow('Unexpected variant: "triangle"')
  })

  it('throws a custom message when given one', () => {
    expect(() => assertNever(1 as never, 'bad shape')).toThrow('bad shape')
  })

  it('stays safe for values JSON cannot serialize', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => assertNever(undefined as never)).toThrow('Unexpected variant: undefined')
    expect(() => assertNever(circular as never)).toThrow('Unexpected variant: [object Object]')
  })
})
