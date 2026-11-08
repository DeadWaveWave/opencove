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

// The generated Cove palette; its contrast is audited where it is generated (themeContrast).
const stylesheet = document.createElement('style')
stylesheet.textContent = normalizeThemeStylesheet(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../src/app/renderer/styles/themes/generated/cove.css',
    ),
    'utf8',
  ),
)
beforeAll(() => document.head.append(stylesheet))
afterAll(() => stylesheet.remove())
afterEach(() => {
  delete document.documentElement.dataset.coveFamily
  delete document.documentElement.dataset.coveTheme
  delete document.documentElement.dataset.coveThemeId
})

/** What the theme owner writes on the root for a theme on Cove's foundation. */
function applyTheme(appearance: 'light' | 'dark', themeId: string = appearance): void {
  document.documentElement.dataset.coveFamily = 'cove'
  document.documentElement.dataset.coveTheme = appearance
  document.documentElement.dataset.coveThemeId = themeId
}

function readPalette() {
  return readTerminalAnsiTheme(getComputedStyle(document.documentElement))
}

describe('Cove ANSI palette', () => {
  it('reads all sixteen colours per appearance and drops them for dark terminal semantics', () => {
    applyTheme('light')
    const light = readPalette()
    expect(Object.keys(light)).toHaveLength(TERMINAL_ANSI_THEME_ENTRIES.length)
    for (const color of Object.values(light)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(resolveTerminalAnsiScheme(light, 'light')).toEqual(light)
    expect(resolveTerminalAnsiScheme(light, 'dark')).toEqual({})

    applyTheme('dark')
    const dark = readPalette()
    expect(Object.keys(dark)).toHaveLength(TERMINAL_ANSI_THEME_ENTRIES.length)
    expect(dark).not.toEqual(light)
  })

  it('leaves the palette unset until the theme owner has named the foundation', () => {
    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.dataset.coveThemeId = 'light'
    expect(readPalette()).toEqual({})
  })

  it('gives a plugin theme the palette of its appearance and none of a stale one', () => {
    applyTheme('light')
    const light = readPalette()
    applyTheme('dark')
    const dark = readPalette()
    applyTheme('light', 'plugin:custom-theme:light')
    expect(readPalette()).toEqual(light)
    applyTheme('dark', 'plugin:custom-theme:light')
    expect(readPalette()).toEqual(dark)
  })
})
