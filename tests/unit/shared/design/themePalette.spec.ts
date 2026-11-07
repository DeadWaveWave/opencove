// @vitest-environment node
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { contrastChecks } from '@shared/design/themeContrast'
import {
  DEFAULT_CONTRAST,
  THEME_FAMILIES,
  generateTheme,
  type Appearance,
} from '@shared/design/themeGenerator'
import { renderFamilyStylesheet, renderPaletteStylesheet } from '@shared/design/themeTokens'

const SCOPE = ':root[data-cove-family=\'cove\'][data-cove-theme-id="plugin:fixture:dusk"]'

function blocks(css: string) {
  const rules: Array<{ selector: string; tokens: Record<string, string> }> = []
  postcss.parse(css).walkRules(rule => {
    const tokens: Record<string, string> = {}
    rule.walkDecls(decl => {
      tokens[decl.prop] = decl.value
    })
    rules.push({ selector: rule.selector, tokens })
  })
  return rules
}

const specificity = (selector: string) =>
  (selector.match(/\[[^\]]+\]|\.[\w-]+|:root/g) ?? []).length

describe('generated plugin palettes', () => {
  it('meet every contrast rule across the inputs a manifest may declare', () => {
    const failures: string[] = []
    for (const appearance of ['dark', 'light'] as const) {
      for (let hue = 0; hue < 360; hue += 30) {
        for (const baseChroma of [0, 0.06]) {
          for (const accentChroma of [0.02, 0.2]) {
            for (const contrast of [0, DEFAULT_CONTRAST, 1]) {
              const input = {
                appearance,
                baseHue: hue,
                baseChroma,
                accentHue: (hue + 150) % 360,
                accentChroma,
                contrast,
              }
              for (const check of contrastChecks(generateTheme(input))) {
                if (check.ratio < check.min) {
                  failures.push(`${JSON.stringify(input)} ${check.id} ${check.ratio.toFixed(2)}`)
                }
              }
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('renders the same tokens as the Cove family for Cove inputs, scoped to the theme', () => {
    const family = blocks(renderFamilyStylesheet('cove'))
    for (const appearance of ['dark', 'light'] as Appearance[]) {
      const palette = blocks(
        renderPaletteStylesheet(SCOPE, {
          ...THEME_FAMILIES.cove,
          appearance,
          contrast: DEFAULT_CONTRAST,
        }),
      )
      const theme = palette.find(
        rule => rule.selector === `${SCOPE}[data-cove-theme='${appearance}']`,
      )
      const familyTheme = family.find(
        rule => rule.selector === `:root[data-cove-family='cove'][data-cove-theme='${appearance}']`,
      )
      expect(theme?.tokens).toEqual(familyTheme?.tokens)
      expect(palette.every(rule => rule.selector.startsWith(SCOPE))).toBe(true)
    }
  })

  it('outranks the family it builds on, for the window and for dark terminals', () => {
    const family = blocks(renderFamilyStylesheet('cove'))
    const palette = blocks(
      renderPaletteStylesheet(SCOPE, {
        ...THEME_FAMILIES.cove,
        appearance: 'light',
        accentHue: 330,
        contrast: 0.5,
      }),
    )
    // Every token the family sets, in the window or in dark terminals, the palette sets more
    // specifically in the same place.
    const terminal = (selector: string) => selector.includes('.terminal-node')
    for (const familyRule of family) {
      for (const token of Object.keys(familyRule.tokens)) {
        const overrides = palette.filter(
          rule => token in rule.tokens && terminal(rule.selector) === terminal(familyRule.selector),
        )
        expect(overrides.length, `${familyRule.selector} ${token}`).toBeGreaterThan(0)
        expect(Math.max(...overrides.map(rule => specificity(rule.selector)))).toBeGreaterThan(
          specificity(familyRule.selector),
        )
      }
    }
    expect(
      palette.find(rule => rule.selector === `${SCOPE}[data-cove-theme='light']`)?.tokens[
        '--cove-accent'
      ],
    ).not.toBe(
      family.find(rule => rule.selector.endsWith("[data-cove-theme='light']"))?.tokens[
        '--cove-accent'
      ],
    )
  })
})
