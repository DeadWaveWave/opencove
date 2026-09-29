import gitBoardOverview from './catalog/git-board/overview.svg?url'

/** Only host-bundled imports are exposed; manifest paths never resolve against the filesystem. */
const PLUGIN_ASSETS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'git-board': { './overview.svg': gitBoardOverview },
}
const NO_ASSETS: Readonly<Record<string, string>> = {}

export function getPluginAssets(pluginId: string): Readonly<Record<string, string>> {
  return Object.hasOwn(PLUGIN_ASSETS, pluginId) ? PLUGIN_ASSETS[pluginId] : NO_ASSETS
}
