import { describe, expect, it } from 'vitest'
import {
  matchesAnyHostPattern,
  matchesHostPattern,
  normalizeHostPattern,
} from '@shared/utils/hostPatterns'

describe('normalizeHostPattern', () => {
  it('normalizes wildcard patterns', () => {
    expect(normalizeHostPattern('  *.FIGMA.COM  ')).toBe('*.figma.com')
  })

  it('returns null for empty patterns', () => {
    expect(normalizeHostPattern('')).toBeNull()
    expect(normalizeHostPattern('   ')).toBeNull()
    expect(normalizeHostPattern('*.')).toBeNull()
  })
})

describe('matchesHostPattern', () => {
  it('matches exact host patterns', () => {
    expect(matchesHostPattern('example.com', 'example.com')).toBe(true)
    expect(matchesHostPattern('api.example.com', 'example.com')).toBe(false)
  })

  it('matches wildcard host patterns', () => {
    expect(matchesHostPattern('figma.com', '*.figma.com')).toBe(false)
    expect(matchesHostPattern('api.figma.com', '*.figma.com')).toBe(true)
    expect(matchesHostPattern('sub.api.figma.com', '*.figma.com')).toBe(true)
  })
})

describe('matchesAnyHostPattern', () => {
  it('matches based on URL hostname', () => {
    expect(
      matchesAnyHostPattern({ url: 'https://api.figma.com/file/123', patterns: ['*.figma.com'] }),
    ).toBe(true)
    expect(matchesAnyHostPattern({ url: 'https://figma.com', patterns: ['*.figma.com'] })).toBe(
      false,
    )
  })

  it('returns false for invalid URLs', () => {
    expect(matchesAnyHostPattern({ url: 'not a url', patterns: ['example.com'] })).toBe(false)
  })
})
