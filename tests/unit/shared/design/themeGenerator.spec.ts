import { describe, expect, it } from 'vitest'
import { contrastRatio, deltaE, mixOver, oklch, rgbToOklab, type Rgb } from '@shared/design/oklch'
import {
  acrylicBackgrounds,
  contrastChecks,
  glassBackgrounds,
  kindSeparation,
} from '@shared/design/themeContrast'
import {
  ANSI_KEYS,
  GLASS,
  THEME_FAMILIES,
  generateFamilyTheme,
  generateTheme,
  kindRoles,
  type Appearance,
  type ThemeFamilyId,
} from '@shared/design/themeGenerator'

const FAMILIES = Object.keys(THEME_FAMILIES) as ThemeFamilyId[]
const APPEARANCES: Appearance[] = ['dark', 'light']
const CONTRAST_LEVELS = [0, 0.35, 1]

describe('theme generator', () => {
  it.each(APPEARANCES)('uses Tide ink scale steps in %s', appearance => {
    const theme = generateFamilyTheme('cove', appearance)
    for (const family of ['ai', 'shell', 'plan', 'knowledge', 'media', 'neutral'] as const) {
      const scale = family === 'neutral' ? theme.neutral : theme.kinds[family]
      expect(kindRoles(theme, family).ink).toEqual(
        scale[appearance === 'light' ? 8 : family === 'neutral' ? 9 : 10],
      )
    }
  })

  it('meets every contrast rule for all built-in families, appearances and contrast levels', () => {
    const failures: string[] = []
    for (const family of FAMILIES) {
      for (const appearance of APPEARANCES) {
        for (const contrast of CONTRAST_LEVELS) {
          for (const check of contrastChecks(generateFamilyTheme(family, appearance, contrast))) {
            if (check.ratio < check.min) {
              failures.push(
                `${family}/${appearance}/k=${contrast} ${check.id}: ${check.ratio.toFixed(2)} < ${check.min}`,
              )
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('checks text on acrylic against pure black, pure white and the pixel wall', () => {
    for (const appearance of APPEARANCES) {
      const ids = contrastChecks(generateFamilyTheme('cove', appearance, 0)).map(check => check.id)
      expect(ids).toContain('text / acrylic (worst)')
      expect(ids).toContain('secondary / acrylic (worst)')
    }
    expect(acrylicBackgrounds(generateFamilyTheme('cove', 'dark', 0)).length).toBeGreaterThan(2)
  })

  it('checks text on window and chrome glass under the full sheen and the mean grain', () => {
    for (const appearance of APPEARANCES) {
      const theme = generateFamilyTheme('cove', appearance, 0)
      const glass = GLASS[appearance]
      const frameColor = appearance === 'dark' ? theme.neutral[1]! : theme.neutral[0]!
      const backdrop = theme.roles.canvas
      const frame = mixOver(frameColor, glass.frame, backdrop)
      const chrome = mixOver(frameColor, glass.chrome, backdrop)
      const backgrounds = glassBackgrounds(theme)
      const lit = (color: Rgb) => mixOver([255, 255, 255], glass.sheen, color)
      // One-pixel grey noise: text sees its mean.
      const grained = (color: Rgb) => mixOver([127.5, 127.5, 127.5], glass.grain, color)
      for (const [list, plain] of [
        [backgrounds.frames, frame],
        [backgrounds.chrome, chrome],
      ] as const) {
        expect(list).toContainEqual(plain)
        expect(list).toContainEqual(lit(plain))
        expect(list).toContainEqual(grained(plain))
        expect(list).toContainEqual(lit(grained(plain)))
      }
    }
  })

  it("checks text and the terminal palette on every window kind's plate", () => {
    for (const appearance of APPEARANCES) {
      const theme = generateFamilyTheme('cove', appearance, 0)
      const { plates } = glassBackgrounds(theme)
      for (const id of ['ai', 'shell', 'plan', 'knowledge', 'media', 'neutral'] as const) {
        expect(plates, `${appearance} ${id}`).toContainEqual(kindRoles(theme, id).plate)
      }
    }
  })

  it('keeps the five kind families apart for normal vision and red-green colour blindness', () => {
    // ΔE (OKLab × 100): 15 is the normal-vision floor, 8 the colour-vision-deficiency target.
    for (const appearance of APPEARANCES) {
      const sep = kindSeparation(generateFamilyTheme('cove', appearance))
      expect(sep.normal, `${appearance} normal`).toBeGreaterThanOrEqual(15)
      expect(sep.protan, `${appearance} protan`).toBeGreaterThanOrEqual(8)
      expect(sep.deutan, `${appearance} deutan`).toBeGreaterThanOrEqual(8)
    }
  })

  it('produces a complete 16-colour terminal palette', () => {
    const theme = generateFamilyTheme('cove', 'light')
    expect(Object.keys(theme.ansi).sort()).toEqual([...ANSI_KEYS].sort())
  })

  it('is deterministic for the same input', () => {
    const input = { ...THEME_FAMILIES.cove, appearance: 'dark' as const, contrast: 0.5 }
    const data = () => {
      const { onSolid: _onSolid, ...rest } = generateTheme(input)
      return rest
    }
    expect(data()).toEqual(data())
  })
})

describe('OKLCH colour maths', () => {
  it('matches the WCAG contrast reference points', () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5)
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2)
    expect(contrastRatio([90, 90, 90], [90, 90, 90])).toBe(1)
  })

  it('maps out-of-gamut requests by dropping chroma while keeping lightness and hue', () => {
    const request = { L: 0.7, C: 0.4, H: 150 }
    const [L, a, b] = rgbToOklab(oklch(request.L, request.C, request.H))
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
    expect(L).toBeCloseTo(request.L, 2)
    expect(Math.abs(hue - request.H)).toBeLessThan(2)
    expect(Math.hypot(a, b)).toBeLessThan(request.C)
  })

  it('composites like the browser and measures symmetric perceptual distance', () => {
    expect(mixOver([255, 0, 0], 0.5, [0, 0, 255])).toEqual([128, 0, 128])
    expect(deltaE([20, 120, 220], [220, 120, 20])).toBeCloseTo(
      deltaE([220, 120, 20], [20, 120, 220]),
    )
    expect(deltaE([42, 42, 42], [42, 42, 42])).toBe(0)
  })
})
