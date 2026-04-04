import { describe, expect, it } from 'vitest'
import {
  isWebsiteUrlAllowedForNavigation,
  resolveWebsiteNavigationUrl,
} from '@shared/utils/websiteUrl'

describe('resolveWebsiteNavigationUrl', () => {
  it('returns null for empty input', () => {
    expect(resolveWebsiteNavigationUrl('')).toEqual({ url: null, error: null })
    expect(resolveWebsiteNavigationUrl('   ')).toEqual({ url: null, error: null })
  })

  it('accepts https/http URLs', () => {
    expect(resolveWebsiteNavigationUrl('https://example.com').url).toBe('https://example.com/')
    expect(resolveWebsiteNavigationUrl('http://example.com/path').url).toBe(
      'http://example.com/path',
    )
  })

  it('adds https:// when protocol is missing', () => {
    expect(resolveWebsiteNavigationUrl('example.com').url).toBe('https://example.com/')
    expect(resolveWebsiteNavigationUrl('example.com/foo').url).toBe('https://example.com/foo')
  })

  it('rejects unsupported protocols', () => {
    const result = resolveWebsiteNavigationUrl('ftp://example.com')
    expect(result.url).toBeNull()
    expect(result.error).toMatch(/Unsupported protocol/i)
  })

  it('rejects invalid URLs', () => {
    const result = resolveWebsiteNavigationUrl('not a url')
    expect(result.url).toBeNull()
    expect(result.error).toBe('Invalid URL')
  })
})

describe('isWebsiteUrlAllowedForNavigation', () => {
  it('returns true for allowed URLs', () => {
    expect(isWebsiteUrlAllowedForNavigation('example.com')).toBe(true)
    expect(isWebsiteUrlAllowedForNavigation('https://example.com')).toBe(true)
  })

  it('returns false for disallowed URLs', () => {
    expect(isWebsiteUrlAllowedForNavigation('file:///etc/passwd')).toBe(false)
    expect(isWebsiteUrlAllowedForNavigation('')).toBe(false)
  })
})
