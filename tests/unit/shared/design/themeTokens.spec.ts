// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import * as prettier from 'prettier'
import { describe, expect, it } from 'vitest'
import { PLUGIN_THEME_TOKENS } from '@contexts/plugins/domain/pluginThemeTypes'
import { contrastRatio, type Rgb } from '@shared/design/oklch'
import {
  GLASS,
  THEME_FAMILY_LIST,
  generateFamilyTheme,
  type Appearance,
} from '@shared/design/themeGenerator'
import {
  renderFamilyStylesheet,
  resolveRoleColors,
  terminalScopeTokens,
  themeTokens,
} from '@shared/design/themeTokens'

const STYLES_DIR = resolve(__dirname, '../../../../src/app/renderer/styles')
const GENERATED_DIR = resolve(STYLES_DIR, 'themes/generated')
const FAMILIES = THEME_FAMILY_LIST.map(family => family.id)
const APPEARANCES: Appearance[] = ['dark', 'light']
const CASES = FAMILIES.flatMap(family => APPEARANCES.map(appearance => ({ family, appearance })))

const LITERAL_COLOR = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i
// Swatches preview other themes, and the mask colour only feeds mask luminance.
const THEME_INDEPENDENT = /^--cove-(?:theme-preview-|mask-opaque$)/

/** Standard-theme colours in base.css that would show through a family that does not replace them. */
function baseLiteralColorTokens(): string[] {
  const root = postcss.parse(readFileSync(resolve(STYLES_DIR, 'base.css'), 'utf8'))
  const names = new Set<string>()
  root.walkRules(rule => {
    if (rule.selector !== ':root' && rule.selector !== ":root[data-cove-theme='light']") {
      return
    }
    rule.walkDecls(/^--cove-/, decl => {
      if (LITERAL_COLOR.test(decl.value) && !THEME_INDEPENDENT.test(decl.prop)) {
        names.add(decl.prop)
      }
    })
  })
  return [...names].sort()
}

describe('generated theme tokens', () => {
  it.each(CASES)(
    'defines every v1 public token for $family/$appearance',
    ({ family, appearance }) => {
      const tokens = themeTokens(generateFamilyTheme(family, appearance))
      expect(PLUGIN_THEME_TOKENS.filter(token => !(token in tokens))).toEqual([])
    },
  )

  it.each(CASES)(
    'tints acrylic with the alpha the contrast matrix checks for $family/$appearance',
    ({ family, appearance }) => {
      const tokens = themeTokens(generateFamilyTheme(family, appearance))
      expect(tokens['--cove-glass-acrylic']).toBe(`${Math.round(GLASS[appearance].acrylic * 100)}%`)
      expect(tokens['--cove-acrylic-surface']).toContain('var(--cove-glass-acrylic)')
    },
  )

  it.each(CASES)(
    'lays the reading plate the contrast matrix checks over the frame for $family/$appearance',
    ({ family, appearance }) => {
      const tokens = themeTokens(generateFamilyTheme(family, appearance))
      // The matrix composes neutral step 1 at the plate alpha over the frame.
      expect(tokens['--cove-reading-plate']).toBe(
        'color-mix(in srgb, var(--cove-neutral-1) var(--cove-glass-plate), transparent)',
      )
      expect(tokens['--cove-reading-plate-edge']).toMatch(/^inset 0 0 0 1px .+, inset 0 1px \dpx /)
      expect(tokens['--cove-reading-plate-glare']).toMatch(/^rgb\(255 255 255 \/ 0(\.\d+)?\)$/)
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

  it.each(CASES)(
    'replaces every literal colour base.css declares for $family/$appearance',
    ({ family, appearance }) => {
      const tokens = themeTokens(generateFamilyTheme(family, appearance))
      expect(baseLiteralColorTokens().filter(token => !(token in tokens))).toEqual([])
    },
  )

  it.each(FAMILIES)(
    'gives dark %s terminal windows its own resolved palette in either shell appearance',
    family => {
      // terminal-node.theme-opencode.css re-declares these on every dark terminal window.
      const shadowed = new Set<string>()
      postcss
        .parse(readFileSync(resolve(STYLES_DIR, 'terminal-node.theme-opencode.css'), 'utf8'))
        .walkDecls(/^--cove-/, decl => {
          shadowed.add(decl.prop)
        })
      const scope = terminalScopeTokens(generateFamilyTheme(family, 'dark'))
      expect([...shadowed].filter(token => !(token in scope))).toEqual([])
      // Only the frame may follow the shell; everything else resolves without the shell's scales.
      expect(
        Object.entries(scope).filter(
          ([name, value]) => value.includes('var(') && name !== '--cove-terminal-node-surface',
        ),
      ).toEqual([])
    },
  )

  it('keeps exactly one generated stylesheet per family', () => {
    const files = readdirSync(GENERATED_DIR).filter(name => name.endsWith('.css'))
    expect(files.sort()).toEqual(FAMILIES.map(family => `${family}.css`).sort())
  })

  it.each(FAMILIES)('matches the committed %s stylesheet (pnpm design:tokens)', async family => {
    const file = resolve(GENERATED_DIR, `${family}.css`)
    const options = (await prettier.resolveConfig(file)) ?? {}
    const css = await prettier.format(renderFamilyStylesheet(family), { ...options, parser: 'css' })
    await expect(css).toMatchFileSnapshot(file)
  })
})
