import { describe, expect, it } from 'vitest'
import { resolveWebsiteNavigationUrl, resolveWebsitePasteUrl } from './websiteUrl'

describe('websiteUrl', () => {
  it('accepts common navigation inputs', () => {
    expect(resolveWebsiteNavigationUrl('https://example.com/docs').url).toBe(
      'https://example.com/docs',
    )
    expect(resolveWebsiteNavigationUrl('example.com/docs').url).toBe('https://example.com/docs')
  })

  it('only auto-creates website nodes from strict pasted URLs', () => {
    expect(resolveWebsitePasteUrl('hello world').url).toBeNull()
    expect(resolveWebsitePasteUrl('just-text').url).toBeNull()
    expect(resolveWebsitePasteUrl('example.com').url).toBe('https://example.com/')
    expect(resolveWebsitePasteUrl('localhost:3000/test').url).toBe('https://localhost:3000/test')
    expect(resolveWebsitePasteUrl('https://openai.com/research').url).toBe(
      'https://openai.com/research',
    )
  })
})
