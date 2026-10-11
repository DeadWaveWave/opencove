import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { normalizeThemeStylesheet } from '../../helpers/themeStylesheet'
import {
  readTerminalAnsiTheme,
  resolveTerminalAnsiScheme,
  TERMINAL_ANSI_THEME_ENTRIES,
} from '@/contexts/workspace/presentation/renderer/components/terminalNode/terminalAnsiTheme'

const stylesheet = document.createElement('style')
stylesheet.textContent = normalizeThemeStylesheet(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../src/app/renderer/styles/themes/pixel-light.terminal.css',
    ),
    'utf8',
  ),
)
beforeAll(() => document.head.append(stylesheet))
afterAll(() => stylesheet.remove())
afterEach(() => {
  delete document.documentElement.dataset.coveThemeId
  delete document.documentElement.dataset.coveThemeBase
})

function luminance(hex: string): number {
  const linear = [1, 3, 5].map(offset => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}

describe('Pixel Light ANSI palette', () => {
  it.each(TERMINAL_ANSI_THEME_ENTRIES)(
    '%s text clears 4.5:1 on its reading surface',
    (_, token) => {
      document.documentElement.dataset.coveThemeId = 'pixel-light'
      const color = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
      expect((luminance('#f8fbfd') + 0.05) / (luminance(color) + 0.05)).toBeGreaterThan(4.5)
    },
  )

  it('keeps other themes unset and removes all sixteen overrides for dark terminal semantics', () => {
    document.documentElement.dataset.coveThemeId = 'pixel-light'
    const palette = readTerminalAnsiTheme(getComputedStyle(document.documentElement))
    expect(Object.keys(palette)).toHaveLength(16)
    expect(resolveTerminalAnsiScheme(palette, 'light')).toEqual(palette)
    expect(resolveTerminalAnsiScheme(palette, 'dark')).toEqual({})
    expect(Object.keys(palette)).toHaveLength(16)
    for (const theme of ['pixel', 'light', 'dark', 'ember', 'ember-light']) {
      document.documentElement.dataset.coveThemeId = theme
      expect(readTerminalAnsiTheme(getComputedStyle(document.documentElement))).toEqual({})
    }
  })

  it('inherits the palette from a plugin base and does not leak it from a stale theme identity', () => {
    document.documentElement.dataset.coveThemeId = 'pixel-light'
    const palette = readTerminalAnsiTheme(getComputedStyle(document.documentElement))
    document.documentElement.dataset.coveThemeBase = 'pixel-light'
    document.documentElement.dataset.coveThemeId = 'plugin:custom-theme:light'
    expect(readTerminalAnsiTheme(getComputedStyle(document.documentElement))).toEqual(palette)
    document.documentElement.dataset.coveThemeId = 'pixel-light'
    document.documentElement.dataset.coveThemeBase = 'pixel'
    expect(readTerminalAnsiTheme(getComputedStyle(document.documentElement))).toEqual({})
  })
})
