import { describe, expect, it } from 'vitest'
import { createRollingTextBuffer } from '../../../src/contexts/workspace/presentation/renderer/utils/rollingTextBuffer'

describe('createRollingTextBuffer', () => {
  it('keeps only the most recent characters', () => {
    const buffer = createRollingTextBuffer({ maxChars: 5, initial: 'abc' })

    expect(buffer.snapshot()).toBe('abc')

    buffer.append('def')
    expect(buffer.snapshot()).toBe('bcdef')

    buffer.append('gh')
    expect(buffer.snapshot()).toBe('defgh')
  })

  it('replaces content when a single chunk exceeds the limit', () => {
    const buffer = createRollingTextBuffer({ maxChars: 4 })

    buffer.append('abcdefgh')
    expect(buffer.snapshot()).toBe('efgh')
  })
})
