import { DEFAULT_UI_THEME, type UiTheme } from '../../settings/domain/uiSettings'
import type { PluginManifest, PluginThemeDeclaration } from './pluginTypes'

export function pluginThemeId(pluginId: string, themeId: string): UiTheme {
  return `plugin:${pluginId}:${themeId}`
}
export function availablePluginThemes(plugins: readonly PluginManifest[]) {
  return plugins
    .filter(plugin => plugin.enabled !== false && plugin.status === 'ready')
    .flatMap(plugin =>
      (plugin.themes ?? []).map(theme => ({
        plugin,
        theme,
        id: pluginThemeId(plugin.id, theme.id),
      })),
    )
}
/** Durable selection never changes as a side effect of availability or fallback. */
export function resolveHostTheme(
  selected: UiTheme,
  plugins: readonly PluginManifest[],
  fallback: UiTheme = DEFAULT_UI_THEME,
): {
  id: UiTheme
  plugin?: PluginManifest
  theme?: PluginThemeDeclaration & { baseScheme: 'light' | 'dark' }
} {
  if (!selected.startsWith('plugin:')) {
    return { id: selected }
  }
  const contribution = availablePluginThemes(plugins).find(item => item.id === selected)
  return contribution
    ? {
        id: selected,
        plugin: contribution.plugin,
        theme: { ...contribution.theme, baseScheme: contribution.theme.appearance },
      }
    : { id: fallback.startsWith('plugin:') ? DEFAULT_UI_THEME : fallback }
}
