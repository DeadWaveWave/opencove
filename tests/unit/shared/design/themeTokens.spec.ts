// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import * as prettier from 'prettier'
import { describe, expect, it } from 'vitest'
import { PLUGIN_THEME_TOKENS } from '@contexts/plugins/domain/pluginThemeTypes'
import { contrastRatio, rgbToOklab, type Rgb } from '@shared/design/oklch'
import {
  GLASS,
  KIND_FAMILIES,
  THEME_FAMILY_LIST,
  generateFamilyTheme,
  kindRoles,
  type Appearance,
  type KindFamilyId,
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
const KIND_IDS = Object.keys(KIND_FAMILIES) as KindFamilyId[]

const hex = (c: Rgb): string => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`
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
    'lays each kind of window on its own solid plate with no edge for $family/$appearance',
    ({ family, appearance }) => {
      const theme = generateFamilyTheme(family, appearance)
      const tokens = themeTokens(theme)
      // The theme's own plate: neutral windows, and every window with kind colours off.
      expect(tokens['--cove-reading-plate']).toBe(hex(theme.roles.plate))
      expect(tokens['--cove-kind-neutral-plate']).toBe(tokens['--cove-reading-plate'])
      // Outside a window (previews, scrims) the terminal colour is the shell plate; in one it is
      // its own kind's plate (terminal-node.css).
      expect(tokens['--cove-terminal-background']).toBe(tokens['--cove-kind-shell-plate'])
      expect(tokens['--cove-glass-plate']).toBeUndefined()
      // Never pure black or white: a faint wash of the accent's hue, or of the window kind's
      // (owner calls, round 4), lifted off the darkest (or lightest) neutral. Near white the sRGB
      // gamut holds less chroma for most hues, so light plates carry what their hue can.
      const extreme = rgbToOklab(theme.neutral[0]!)[0]
      const minChroma = appearance === 'dark' ? 0.015 : 0.01
      const plates = [
        ['neutral', theme.input.accentHue],
        ...KIND_IDS.map(id => [id, KIND_FAMILIES[id].hue] as const),
      ] as const
      for (const [id, expectedHue] of plates) {
        const plate = kindRoles(theme, id).plate
        expect(tokens[`--cove-kind-${id}-plate`], id).toBe(hex(plate))
        const [L, a, b] = rgbToOklab(plate)
        const hue = (Math.atan2(b, a) * 180) / Math.PI
        expect(Math.hypot(a, b), id).toBeGreaterThanOrEqual(minChroma)
        expect(Math.hypot(a, b), id).toBeLessThanOrEqual(0.035)
        expect(Math.abs(((hue - expectedHue + 540) % 360) - 180), id).toBeLessThanOrEqual(8)
        expect(appearance === 'dark' ? L - extreme : extreme - L, id).toBeGreaterThanOrEqual(0.01)
      }
      // It melts into the frame (window-plate.css): no line, edge or glare of its own.
      expect(tokens['--cove-reading-plate-line']).toBeUndefined()
      expect(tokens['--cove-reading-plate-edge']).toBeUndefined()
      expect(tokens['--cove-reading-plate-glare']).toBeUndefined()
    },
  )

  it.each(CASES)(
    'lights window and chrome glass with a sheen, grain and a specular rim for $family/$appearance',
    ({ family, appearance }) => {
      const tokens = themeTokens(generateFamilyTheme(family, appearance))
      const glass = GLASS[appearance]
      expect(tokens['--cove-glass-sheen']).toBe(`rgb(255 255 255 / ${glass.sheen})`)
      expect(tokens['--cove-glass-rim-hi']).toBe(`rgb(255 255 255 / ${glass.rimHi})`)
      expect(tokens['--cove-glass-rim-lo']).toBe(`rgb(255 255 255 / ${glass.rimLo})`)
      // The grain image is drawn at startup (bootstrap/installGlassGrain.ts); before that, and in
      // tests, there is none.
      expect(tokens['--cove-glass-grain']).toBe(`var(--cove-glass-grain-${appearance}, none)`)
      expect(tokens['--cove-acrylic-grain']).toBe('var(--cove-glass-grain)')
      expect(tokens['--cove-node-background-image']).toBe(
        'linear-gradient(180deg, var(--cove-glass-sheen), transparent 30%), var(--cove-glass-grain)',
      )
      expect(tokens['--cove-chrome-background-image']).toBe(
        'linear-gradient(180deg, var(--cove-glass-sheen), transparent 60%), var(--cove-glass-grain)',
      )
      expect(tokens['--cove-node-rim']).toBe(
        'linear-gradient(162deg, var(--cove-glass-rim-hi), var(--cove-glass-rim-lo) 30%, transparent 54%, var(--cove-glass-rim-lo))',
      )
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
      const dark = generateFamilyTheme(family, 'dark')
      const scope = terminalScopeTokens(dark)
      expect([...shadowed].filter(token => !(token in scope))).toEqual([])
      // Only the frame may follow the shell; everything else resolves without the shell's scales.
      // The terminal colour is the window kind's plate (terminal-node.css), so the scope carries
      // the dark plates a terminal window can pick from.
      const follows = new Set(['--cove-terminal-node-surface', '--cove-terminal-background'])
      expect(
        Object.entries(scope).filter(
          ([name, value]) => value.includes('var(') && !follows.has(name),
        ),
      ).toEqual([])
      expect(scope['--cove-terminal-background']).toBe(
        `var(--cove-terminal-kind-plate, ${scope['--cove-kind-shell-plate']})`,
      )
      for (const id of ['shell', 'ai', 'neutral'] as const) {
        expect(scope[`--cove-kind-${id}-plate`], id).toBe(hex(kindRoles(dark, id).plate))
      }
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
