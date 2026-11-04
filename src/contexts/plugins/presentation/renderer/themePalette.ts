import { renderPaletteStylesheet } from '@shared/design/themeTokens'
import type { PluginThemeDeclaration } from '../../domain/pluginTypes'

const escapeAttribute = (value: string): string =>
  value.replace(/["\\]/g, character => `\\${character}`).replace(/\n/g, '\\a ')

/**
 * The applied theme's generated palette (theme API v2), or null for a theme without one. It sits
 * in the host layer, so the theme's own stylesheet and manifest tokens still override it, as they
 * override the foundation.
 */
export function pluginThemePaletteCss(
  themeId: string,
  theme: Pick<PluginThemeDeclaration, 'appearance' | 'palette'>,
): string | null {
  if (!theme.palette) {
    return null
  }
  const scope = `:root[data-cove-family='cove'][data-cove-theme-id="${escapeAttribute(themeId)}"]`
  const css = renderPaletteStylesheet(scope, { ...theme.palette, appearance: theme.appearance })
  return `@layer opencove {\n${css}}\n`
}
