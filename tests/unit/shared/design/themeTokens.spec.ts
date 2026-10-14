// @vitest-environment node

import { resolve } from 'node:path'
import * as prettier from 'prettier'
import { describe, expect, it } from 'vitest'
import { PLUGIN_THEME_TOKENS } from '@contexts/plugins/domain/pluginThemeTypes'
import { contrastRatio, type Rgb } from '@shared/design/oklch'
import {
  THEME_FAMILY_LIST,
  generateFamilyTheme,
  type Appearance,
} from '@shared/design/themeGenerator'
import { renderFamilyStylesheet, resolveRoleColors, themeTokens } from '@shared/design/themeTokens'

const GENERATED_DIR = resolve(__dirname, '../../../../src/app/renderer/styles/themes/generated')
const FAMILIES = THEME_FAMILY_LIST.map(family => family.id)
const APPEARANCES: Appearance[] = ['dark', 'light']
const CASES = FAMILIES.flatMap(family => APPEARANCES.map(appearance => ({ family, appearance })))

describe('generated theme tokens', () => {
  it.each(CASES)(
    'defines every v1 public token for $family/$appearance',
    ({ family, appearance }) => {
      const tokens = themeTokens(generateFamilyTheme(family, appearance))
      expect(PLUGIN_THEME_TOKENS.filter(token => !(token in tokens))).toEqual([])
    },
  )

  it.each(CASES)(
    'references only tokens it defines for $family/$appearance',
    ({ family, appearance }) => {
      const tokens = themeTokens(generateFamilyTheme(family, appearance))
      const references = Object.values(tokens).flatMap(value =>
        [...value.matchAll(/var\((--cove-[a-z0-9-]+)\)/g)].map(match => match[1]!),
      )
      expect(references.filter(reference => !(reference in tokens))).toEqual([])
    },
  )

  it.each(CASES)(
    'keeps role colours readable for $family/$appearance',
    ({ family, appearance }) => {
      const roles = resolveRoleColors(generateFamilyTheme(family, appearance))
      const failures: string[] = []
      const check = (id: string, foreground: Rgb, background: Rgb, min: number) => {
        const ratio = contrastRatio(foreground, background)
        if (ratio < min) {
          failures.push(`${id}: ${ratio.toFixed(2)} < ${min}`)
        }
      }
      const backgrounds = [
        ['canvas', roles.canvas],
        ['elevated', roles.elevated],
        ['window', roles.frame],
      ] as const
      for (const [name, background] of backgrounds) {
        check(`text / ${name}`, roles.text, background, 4.5)
        check(`muted / ${name}`, roles.textMuted, background, 4.5)
        check(`accent text / ${name}`, roles.accentText, background, 4.5)
        // Faint text carries tertiary metadata only, like today's themes (about 3.6:1).
        check(`faint / ${name}`, roles.textFaint, background, 3)
        check(`focus ring / ${name}`, roles.focusRing, background, 3)
      }
      check('on accent / accent', roles.onAccent, roles.accent, 4.5)
      check('terminal text / terminal', roles.terminalForeground, roles.terminalBackground, 4.5)
      check('terminal cursor / terminal', roles.terminalCursor, roles.terminalBackground, 3)
      expect(failures).toEqual([])
    },
  )

  it.each(FAMILIES)('matches the committed %s stylesheet (pnpm design:tokens)', async family => {
    const file = resolve(GENERATED_DIR, `${family}.css`)
    const options = (await prettier.resolveConfig(file)) ?? {}
    const css = await prettier.format(renderFamilyStylesheet(family), { ...options, parser: 'css' })
    await expect(css).toMatchFileSnapshot(file)
  })
})
