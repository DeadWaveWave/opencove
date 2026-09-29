import gitBoardReadme from './catalog/git-board/README.md?raw'
import gitBoardChineseReadme from './catalog/git-board/README.zh-CN.md?raw'
import { getPluginAssets } from './pluginAssets'

export interface PluginDetail {
  author: string
  readme: string
  assets: Readonly<Record<string, string>>
}

export function getPluginDetail(pluginId: string, language: string): PluginDetail | null {
  if (pluginId !== 'git-board') {
    return null
  }
  return {
    author: 'OpenCove',
    readme: language.startsWith('zh') ? gitBoardChineseReadme : gitBoardReadme,
    assets: getPluginAssets(pluginId),
  }
}
