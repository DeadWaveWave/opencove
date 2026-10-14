import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { normalizeThemeStylesheet } from '../../helpers/themeStylesheet'
import {
  UI_THEMES,
  UI_THEME_DESCRIPTORS,
  resolveUiThemeBaseScheme,
  type BuiltinUiTheme,
  type UiTheme,
} from '../../../src/contexts/settings/domain/uiSettings'

const stylesheet = document.createElement('style')
const themes: UiTheme[] = [...UI_THEMES]

beforeAll(() => {
  const cssFiles = [
    'base.css',
    'control-center.css',
    'terminal-node.css',
    'terminal-node.theme-opencode.css',
    'task-node.css',
    'note-node.css',
    'role-node.css',
    'document-node.css',
    'website-node.css',
    'image-node.css',
    'node-chrome.css',
    'workspace-overlays.spaces.css',
    'themes/generated/cove.css',
    'themes/pixel.css',
    'themes/pixel-light.css',
    'themes/pixel-material.css',
  ]
  const cssRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../src/app/renderer/styles',
  )
  stylesheet.textContent = normalizeThemeStylesheet(
    cssFiles.map(file => readFileSync(resolve(cssRoot, file), 'utf8')).join('\n'),
  )
  document.head.append(stylesheet)
})

afterEach(() => {
  document.body.replaceChildren()
  delete document.documentElement.dataset.coveTheme
  delete document.documentElement.dataset.coveThemeId
  delete document.documentElement.dataset.coveThemeBase
  delete document.documentElement.dataset.coveFamily
})
afterAll(() => stylesheet.remove())

function selectTheme(theme: UiTheme, prefersDark = true) {
  const root = document.documentElement
  // Like the theme owner: the family follows the applied foundation, not the selected identity.
  const base = (root.dataset.coveThemeBase ?? theme) as BuiltinUiTheme
  root.dataset.coveTheme = resolveUiThemeBaseScheme(base, prefersDark)
  root.dataset.coveThemeId = theme
  root.dataset.coveFamily = UI_THEME_DESCRIPTORS[base].family
  const style = getComputedStyle(document.documentElement)
  return {
    blue: style.getPropertyValue('--cove-pixel-blue').trim(),
    cyan: style.getPropertyValue('--cove-pixel-cyan').trim(),
    mint: style.getPropertyValue('--cove-pixel-mint').trim(),
    opacity: Number.parseFloat(style.getPropertyValue('--cove-pixel-grid-opacity')),
  }
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map(value =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  )
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}

describe('theme-adaptive pixel effects', () => {
  it('gives Pixel Light its own light palette while explicit dark terminals remain dark', () => {
    const genericLight = selectTheme('light')
    const pixelLight = selectTheme('pixel-light')
    expect(pixelLight).not.toEqual(genericLight)
    const rootStyle = getComputedStyle(document.documentElement)
    const surface = rootStyle.getPropertyValue('--cove-node-surface').trim()
    const text = rootStyle.getPropertyValue('--cove-text').trim()
    expect(luminance(surface)).toBeGreaterThan(0.9)
    expect((luminance(surface) + 0.05) / (luminance(text) + 0.05)).toBeGreaterThan(7)
    const terminal = document.createElement('div')
    terminal.className = 'terminal-node'
    document.body.append(terminal)
    expect(rootStyle.getPropertyValue('--cove-terminal-background').trim()).toBe('#f8fbfd')
    terminal.dataset.coveTerminalNodeTheme = 'dark'
    expect(getComputedStyle(terminal).getPropertyValue('--cove-terminal-background').trim()).toBe(
      '#0a0f1d',
    )
  })

  it.each(themes)('provides visible effect tokens independently of the %s theme toggle', theme => {
    const palette = selectTheme(theme)
    expect(palette.opacity).toBeGreaterThan(0)
    expect(palette.opacity).toBeLessThanOrEqual(0.8)
    expect(new Set([palette.blue, palette.cyan, palette.mint]).size).toBe(3)
  })

  it('makes the System palette follow its resolved base scheme', () => {
    const dark = selectTheme('system', true)
    const light = selectTheme('system', false)
    expect(light).not.toEqual(dark)
    expect(light).toEqual(selectTheme('light'))
    expect(dark).toEqual(selectTheme('dark'))
  })

  it.each(['dark', 'light', 'pixel', 'pixel-light'] as const)(
    'inherits the %s palette from the resolved base even when the selected identity differs',
    theme => {
      const palette = selectTheme(theme)
      document.documentElement.dataset.coveThemeBase = theme
      expect(selectTheme(`plugin:custom-theme:${theme}`)).toEqual(palette)
      // A stale selected identity cannot override the authoritative inherited base.
      expect(selectTheme(theme === 'pixel' ? 'dark' : 'pixel')).toEqual(palette)
    },
  )

  it.each(themes)('keeps opaque foreground fragments distinguishable on the %s surface', theme => {
    const palette = selectTheme(theme)
    const surface = getComputedStyle(document.documentElement)
      .getPropertyValue('--cove-app-background-elevated')
      .trim()
    for (const color of [palette.blue, palette.cyan, palette.mint]) {
      const [low, high] = [luminance(color), luminance(surface)].sort((left, right) => left - right)
      expect((high! + 0.05) / (low! + 0.05)).toBeGreaterThan(3)
    }
  })

  it('preserves the Pixel preview identity while other themes adapt their effect colors', () => {
    selectTheme('pixel')
    const preview = document.createElement('span')
    preview.className = 'control-center__theme-preview'
    preview.dataset.themePreview = 'pixel'
    document.body.append(preview)
    const pixelPreview = getComputedStyle(preview).backgroundImage
    expect(pixelPreview).toContain('linear-gradient')
    selectTheme('dark')
    expect(getComputedStyle(preview).backgroundImage).toBe(pixelPreview)
  })

  it.each(themes)('shows real selection on Document and Role nodes in %s', theme => {
    selectTheme(theme)
    for (const kind of ['document', 'role']) {
      const canvas = document.createElement('div')
      canvas.className = 'workspace-canvas'
      const wrapper = document.createElement('div')
      wrapper.className = 'react-flow__node'
      const node = document.createElement('div')
      node.className = `${kind}-node`
      wrapper.append(node)
      canvas.append(wrapper)
      document.body.append(canvas)
      const idleBorder = getComputedStyle(node).borderTopColor
      wrapper.classList.add('selected')
      expect(getComputedStyle(node).borderTopColor).not.toBe(idleBorder)
    }
  })
})
