import { describe, expect, it } from 'vitest'
import { repositoryMarkdownUrl } from './PluginRepositoryDetail'
import { resolvePluginMarkdownUrl } from '@contexts/plugins/presentation/renderer/PluginReadme'
import type { PluginRepositoryDetails } from '@contexts/plugins/domain/pluginRepositoryTypes'
const details: PluginRepositoryDetails = {
  repository: 'https://github.com/example/plugin',
  name: 'example/plugin',
  commit: 'a'.repeat(40),
  ref: 'main',
  description: '',
  stars: 0,
  readme: '',
  readmePath: 'docs/README.md',
  manifest: null,
  manifestError: null,
}
describe('repository Markdown links', () => {
  it('resolves relative images and links at the reviewed commit without escaping its repository', () => {
    expect(repositoryMarkdownUrl(details, '../images/preview.png', 'src')).toBe(
      `https://raw.githubusercontent.com/example/plugin/${details.commit}/images/preview.png`,
    )
    expect(repositoryMarkdownUrl(details, 'guide.md', 'href')).toBe(
      `${details.repository}/blob/${details.commit}/docs/guide.md`,
    )
    for (const path of ['../../../../other/repo', '//evil.test/image', '/outside', '..\\outside']) {
      expect(repositoryMarkdownUrl(details, path, 'src')).toBe('')
    }
  })
  it('retains safe anchors and HTTPS images while shared renderer rejects unsafe schemes and local files', () => {
    expect(repositoryMarkdownUrl(details, '#usage', 'href')).toBe('#usage')
    for (const url of ['javascript:alert(1)', 'file:///private/file', 'data:text/html,bad']) {
      expect(
        resolvePluginMarkdownUrl(repositoryMarkdownUrl(details, url, 'href'), 'href', {}),
      ).toBe('')
    }
  })
})
