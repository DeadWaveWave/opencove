import { PLUGIN_THEME_TOKENS } from '../../domain/pluginThemeTypes'
import { readAppliedThemeFonts } from './themeApplication'

const METRIC_TOKENS = [
  '--cove-font-ui',
  '--cove-ui-font-scale',
  '--cove-node-title-font-size',
  '--cove-node-header-height',
  '--cove-node-header-padding-inline',
  '--cove-node-icon-size',
  '--cove-compact-icon-size',
  '--cove-control-gap',
  '--cove-menu-row-height',
  '--cove-sidebar-row-height',
  '--cove-control-height-md',
  '--cove-node-radius',
] as const

/** Versioned presentation context, shared by preview and runtime iframe bridges. */
export function pluginThemeContext() {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const read = (name: string) => style.getPropertyValue(name).trim()
  const colors = Object.fromEntries(PLUGIN_THEME_TOKENS.map(name => [name, read(name)]))
  return {
    theme: root.dataset.coveTheme === 'light' ? 'light' : 'dark',
    themeId: root.dataset.coveThemeId ?? 'pixel',
    baseThemeId: root.dataset.coveThemeBase ?? root.dataset.coveThemeId ?? 'pixel',
    themeVersion: 1,
    colors,
    tokens: { ...colors, ...Object.fromEntries(METRIC_TOKENS.map(name => [name, read(name)])) },
    fonts: readAppliedThemeFonts(),
    reducedMotion:
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}
