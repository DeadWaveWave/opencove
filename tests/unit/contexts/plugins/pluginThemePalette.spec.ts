// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeLocalPluginPackage } from '../../../../src/contexts/plugins/domain/localPluginValidation'
import { DEFAULT_CONTRAST, THEME_FAMILIES } from '../../../../src/shared/design/themeGenerator'

const manifest = (theme: Record<string, unknown>) => ({
  apiVersion: 1,
  id: 'palette-fixture',
  version: '1.0.0',
  displayName: 'Palette fixture',
  description: 'Generated theme fixture.',
  contributes: { themes: [{ id: 'dusk', title: 'Dusk', appearance: 'dark', ...theme }] },
})
const themeOf = (theme: Record<string, unknown>) =>
  normalizeLocalPluginPackage(manifest(theme)).contributes!.themes![0]!

describe('plugin theme palette (theme API v2)', () => {
  it('turns the four inputs into generator input, defaulting base and contrast to Cove', () => {
    expect(themeOf({ palette: { accent: { hue: 330, chroma: 0.14 } } }).palette).toEqual({
      baseHue: THEME_FAMILIES.cove.baseHue,
      baseChroma: THEME_FAMILIES.cove.baseChroma,
      accentHue: 330,
      accentChroma: 0.14,
      contrast: DEFAULT_CONTRAST,
    })
    expect(
      themeOf({
        appearance: 'light',
        extends: 'light',
        palette: { base: { hue: 40, chroma: 0.03 }, accent: { hue: 20, chroma: 0.2 }, contrast: 1 },
      }).palette,
    ).toEqual({ baseHue: 40, baseChroma: 0.03, accentHue: 20, accentChroma: 0.2, contrast: 1 })
  })

  it('is a visual contribution on its own, so a palette-only theme is valid', () => {
    const theme = themeOf({ palette: { accent: { hue: 150, chroma: 0.1 } } })
    expect(theme.extends).toBeUndefined()
    expect(theme.tokens).toEqual({})
  })

  it.each([
    [{ accent: { hue: 330 } }, 'chroma'],
    [{ accent: { hue: 361, chroma: 0.1 } }, 'hue'],
    [{ accent: { hue: -1, chroma: 0.1 } }, 'hue'],
    [{ accent: { hue: 30, chroma: 0.21 } }, 'chroma'],
    [{ base: { hue: 30, chroma: 0.07 }, accent: { hue: 30, chroma: 0.1 } }, 'chroma'],
    [{ accent: { hue: 30, chroma: 0.1 }, contrast: 1.5 }, 'contrast'],
    [{ accent: { hue: '30', chroma: 0.1 } }, 'hue'],
    [{ base: { hue: 30, chroma: 0.02 } }, 'accent'],
    [{ accent: { hue: 30, chroma: 0.1 }, kinds: {} }, 'palette'],
    ['violet', 'palette'],
  ])('rejects %j', (palette, field) => {
    expect(() => themeOf({ palette })).toThrow(new RegExp(field, 'i'))
  })

  it('takes a palette on every foundation, retired Pixel included (now Cove dark)', () => {
    expect(
      themeOf({ extends: 'pixel', palette: { accent: { hue: 330, chroma: 0.14 } } }).extends,
    ).toBe('dark')
    expect(
      themeOf({ extends: 'dark', palette: { accent: { hue: 330, chroma: 0.14 } } }).extends,
    ).toBe('dark')
  })
})
