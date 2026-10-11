import { enSettingsPanelPlugins } from '@app/renderer/i18n/locales/en.settingsPanel.plugins'
import { zhCNSettingsPanelPlugins } from '@app/renderer/i18n/locales/zh-CN.settingsPanel.plugins'
import startEn from '../../../../../docs/plugins/handbook/START.en.md?raw'
import startZh from '../../../../../docs/plugins/handbook/START.zh-CN.md?raw'
import installEn from '../../../../../docs/plugins/handbook/INSTALL.en.md?raw'
import installZh from '../../../../../docs/plugins/handbook/INSTALL.zh-CN.md?raw'
import buildEn from '../../../../../docs/plugins/handbook/BUILD.en.md?raw'
import buildZh from '../../../../../docs/plugins/handbook/BUILD.zh-CN.md?raw'
import referenceEn from '../../../../../docs/plugins/handbook/REFERENCE.en.md?raw'
import referenceZh from '../../../../../docs/plugins/handbook/REFERENCE.zh-CN.md?raw'
import overview from '../../../../../docs/plugins/README.md?raw'
import authoring from '../../../../../docs/plugins/AUTHORING.md?raw'
import api from '../../../../../docs/plugins/API.md?raw'
import design from '../../../../../docs/plugins/VISUAL_DESIGN.md?raw'
import commands from '../../../../../docs/plugins/COMMANDS.md?raw'
import runtime from '../../../../../docs/plugins/RUNTIME.md?raw'
import example from '../../../../../docs/plugins/examples/hello-clock/README.md?raw'
import exampleIcon from '../../../../../docs/plugins/examples/hello-clock/icon.svg?url'

const optionalReferences = import.meta.glob<string>(
  [
    '../../../../../docs/plugins/HOST_EXTENSIONS.md',
    '../../../../../docs/plugins/THEMES.md',
    '../../../../../docs/plugins/HOST_API.md',
    '../../../../../docs/plugins/FILESYSTEM.md',
    '../../../../../docs/plugins/CANVAS_API.md',
    '../../../../../docs/plugins/EVENTS.md',
    '../../../../../docs/plugins/SIDEBAR.md',
    '../../../../../docs/plugins/DISTRIBUTION.md',
    '../../../../../docs/plugins/ROADMAP.md',
    '../../../../../docs/plugins/TARGETS.md',
    '../../../../../docs/plugins/COMPATIBILITY.md',
  ],
  { query: '?raw', import: 'default', eager: true },
)

export interface PluginHandbookArticle {
  id: string
  title: string
  description: string
  category: 'start' | 'tutorial' | 'reference'
  path: string
  markdown: string
  assets?: Readonly<Record<string, string>>
}

/** Version-matched bundled documents; no filesystem or network reads in the reader. */
export function pluginHandbook(language: string): PluginHandbookArticle[] {
  const zh = language.startsWith('zh')
  const locale = zh ? 'zh-CN' : 'en'
  const labels = (zh ? zhCNSettingsPanelPlugins : enSettingsPanelPlugins).library.articles
  return [
    {
      id: 'start',
      ...labels.start,
      category: 'start',
      path: `handbook/START.${locale}.md`,
      markdown: zh ? startZh : startEn,
    },
    {
      id: 'install',
      ...labels.install,
      category: 'start',
      path: `handbook/INSTALL.${locale}.md`,
      markdown: zh ? installZh : installEn,
    },
    {
      id: 'build',
      ...labels.build,
      category: 'tutorial',
      path: `handbook/BUILD.${locale}.md`,
      markdown: zh ? buildZh : buildEn,
    },
    {
      id: 'reference',
      ...labels.reference,
      category: 'tutorial',
      path: `handbook/REFERENCE.${locale}.md`,
      markdown: zh ? referenceZh : referenceEn,
    },
    {
      id: 'overview',
      ...labels.overview,
      category: 'reference',
      path: 'README.md',
      markdown: overview,
    },
    ...(
      [
        'HOST_API',
        'HOST_EXTENSIONS',
        'THEMES',
        'FILESYSTEM',
        'CANVAS_API',
        'EVENTS',
        'SIDEBAR',
        'TARGETS',
        'COMPATIBILITY',
        'DISTRIBUTION',
        'ROADMAP',
      ] as const
    ).flatMap(name => {
      const markdown = optionalReferences[`../../../../../docs/plugins/${name}.md`]
      return markdown
        ? [
            {
              id: name.toLowerCase(),
              ...labels[name],
              category: 'reference' as const,
              path: `${name}.md`,
              markdown,
            },
          ]
        : []
    }),
    {
      id: 'authoring',
      ...labels.authoring,
      category: 'reference',
      path: 'AUTHORING.md',
      markdown: authoring,
    },
    {
      id: 'api',
      ...labels.api,
      category: 'reference',
      path: 'API.md',
      markdown: api,
    },
    {
      id: 'design',
      ...labels.design,
      category: 'reference',
      path: 'VISUAL_DESIGN.md',
      markdown: design,
    },
    {
      id: 'commands',
      ...labels.commands,
      category: 'reference',
      path: 'COMMANDS.md',
      markdown: commands,
    },
    {
      id: 'example',
      ...labels.example,
      category: 'reference',
      path: 'examples/hello-clock/README.md',
      markdown: example,
      assets: { 'icon.svg': exampleIcon },
    },
    {
      id: 'runtime',
      ...labels.runtime,
      category: 'reference',
      path: 'RUNTIME.md',
      markdown: runtime,
    },
  ]
}

export function resolveHandbookLink(
  href: string,
  article: PluginHandbookArticle,
  articles: PluginHandbookArticle[],
): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) {
    return null
  }
  const target = new URL(href, `https://handbook.opencove.invalid/${article.path}`)
  const match = articles.find(item => `/${item.path}` === target.pathname)
  return match ? `${match.id}${target.hash}` : null
}
