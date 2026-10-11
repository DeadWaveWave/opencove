import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDesiredTerminalAppearanceValue } from '@/contexts/workspace/presentation/renderer/components/terminalNode/terminalAppearance'
import { UI_THEME_DESCRIPTORS } from '@/contexts/settings/domain/uiSettings'
import { normalizeThemeStylesheet } from '../../helpers/themeStylesheet'

const terminalCss = readFileSync('src/app/renderer/styles/terminal-node.theme-opencode.css', 'utf8')
const emberCss = readFileSync('src/app/renderer/styles/themes/ember.css', 'utf8')
const css = document.createElement('style')

afterEach(async () => {
  css.remove()
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.coveTheme
  delete document.documentElement.dataset.coveThemeId
  delete document.documentElement.dataset.coveThemeBase
  await Promise.resolve()
})

describe('authored terminal token precedence', () => {
  it.each(['dark', 'light', 'ember', 'ember-light', 'pixel', 'pixel-light'] as const)(
    'inherits the %s terminal scheme independently of the contributed theme identity',
    base => {
      const descriptor = UI_THEME_DESCRIPTORS[base]
      document.documentElement.dataset.coveTheme = descriptor.baseScheme
      document.documentElement.dataset.coveThemeBase = base
      document.documentElement.dataset.coveThemeId = `plugin:terminal-palette:${base}`
      const synced = resolveDesiredTerminalAppearanceValue({ terminalThemeMode: 'sync-with-ui' })
      expect(synced.terminalScheme).toBe(descriptor.terminalScheme)
      const independent = resolveDesiredTerminalAppearanceValue({ terminalThemeMode: 'dark' })
      expect(independent.terminalScheme).toBe('dark')
    },
  )

  it.each([
    { base: 'dark', defaultBackground: '#0a0f1d' },
    { base: 'ember', defaultBackground: '#15110e' },
  ])(
    'respects $base theme overrides only while following the interface',
    async ({ base, defaultBackground }) => {
      document.documentElement.dataset.coveTheme = 'dark'
      document.documentElement.dataset.coveThemeBase = base
      document.documentElement.dataset.coveThemeId = `plugin:terminal-palette:${base}`
      css.textContent = normalizeThemeStylesheet(terminalCss + emberCss)
      document.head.appendChild(css)
      const declarations = {
        '--cove-terminal-background': '#302838',
        '--cove-terminal-foreground': '#f0e5dc',
        '--cove-terminal-cursor': '#ffbc66',
        '--cove-terminal-selection': '#675366',
        '--cove-terminal-node-header-surface': '#473343',
      }
      for (const [name, value] of Object.entries(declarations)) {
        document.documentElement.style.setProperty(name, value)
      }

      const synced = resolveDesiredTerminalAppearanceValue({ terminalThemeMode: 'sync-with-ui' })
      expect(synced.cssTokens).toMatchObject(declarations)
      expect(synced.xtermTheme).toMatchObject({
        background: '#302838',
        foreground: '#f0e5dc',
        cursor: '#ffbc66',
        selectionBackground: '#675366',
      })
      const independent = resolveDesiredTerminalAppearanceValue({ terminalThemeMode: 'dark' })
      expect(independent.xtermTheme.background).toBe(defaultBackground)
      expect(independent.cssTokens['--cove-terminal-node-header-surface']).not.toBe('#473343')
      expect(document.querySelector('[data-cove-terminal-theme-probe]')).toBeNull()

      await Promise.resolve()
      document.documentElement.removeAttribute('style')
      const restored = resolveDesiredTerminalAppearanceValue({ terminalThemeMode: 'sync-with-ui' })
      expect(restored.xtermTheme.background).toBe(defaultBackground)
    },
  )
})
