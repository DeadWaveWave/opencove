import { describe, expect, it } from 'vitest'
import { pluginHandbook, resolveHandbookLink } from './pluginHandbook'

describe('bundled plugin handbook navigation', () => {
  it.each(['en', 'zh-CN'])('resolves only registered version-matched documents in %s', language => {
    const articles = pluginHandbook(language)
    const start = articles.find(item => item.id === 'start')!
    const tutorial = articles.find(item => item.id === 'build')!
    expect(resolveHandbookLink(`./BUILD.${language}.md`, start, articles)).toBe('build')
    expect(resolveHandbookLink('../API.md#view-api', tutorial, articles)).toBe('api#view-api')
    expect(resolveHandbookLink('../TARGETS.md', tutorial, articles)).toBe('targets')
    for (const name of ['HOST_API', 'FILESYSTEM', 'CANVAS_API', 'EVENTS', 'SIDEBAR']) {
      expect(resolveHandbookLink(`../${name}.md`, tutorial, articles)).toBe(name.toLowerCase())
    }
    expect(resolveHandbookLink('../COMPATIBILITY.md', tutorial, articles)).toBe('compatibility')
    expect(resolveHandbookLink('../../../private.md', start, articles)).toBeNull()
    expect(resolveHandbookLink('https://example.com/API.md', tutorial, articles)).toBeNull()
    expect(resolveHandbookLink('//example.com/API.md', tutorial, articles)).toBeNull()
    expect(resolveHandbookLink('#chapter', tutorial, articles)).toBeNull()
    expect(tutorial.markdown).toContain('opencove plugin guide')
  })
})
