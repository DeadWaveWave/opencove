import { describe, expect, it } from 'vitest'
import {
  resolveBrowserNavigationTarget,
  resolveBrowserSearchUrl,
} from '../../../src/contexts/settings/domain/browserSettings'

describe('browser settings helpers', () => {
  it('keeps valid urls as navigation targets', () => {
    expect(resolveBrowserNavigationTarget('example.com/docs', 'google')).toBe(
      'https://example.com/docs',
    )
    expect(resolveBrowserNavigationTarget('https://example.com/docs', 'duckduckgo')).toBe(
      'https://example.com/docs',
    )
  })

  it('uses the selected search engine for non-url input', () => {
    expect(resolveBrowserNavigationTarget('open cove browser', 'duckduckgo')).toBe(
      'https://duckduckgo.com/?q=open%20cove%20browser',
    )
    expect(resolveBrowserNavigationTarget('opencove', 'bing')).toBe(
      'https://www.bing.com/search?q=opencove',
    )
    expect(resolveBrowserNavigationTarget('opencove', 'google')).toBe(
      'https://www.google.com/search?igu=1&q=opencove',
    )
    expect(resolveBrowserSearchUrl('canvas browser', 'brave')).toBe(
      'https://search.brave.com/search?q=canvas%20browser',
    )
  })

  it('returns an empty target for an empty home-page input', () => {
    expect(resolveBrowserNavigationTarget('   ', 'google')).toBe('')
  })
})
