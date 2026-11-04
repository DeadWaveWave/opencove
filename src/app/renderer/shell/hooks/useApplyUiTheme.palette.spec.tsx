import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { UiTheme } from '@contexts/settings/domain/uiSettings'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import { useApplyUiTheme } from './useApplyUiTheme'

const state = vi.hoisted(() => ({ plugins: [] as PluginManifest[] }))
vi.mock('@contexts/plugins/presentation/renderer/usePluginRegistry', () => ({
  usePluginRegistry: () => state,
}))
vi.mock('@contexts/plugins/presentation/renderer/usePluginDetails', () => ({
  usePluginDetails: () => ({ detail: null, error: null }),
}))

const plugin: PluginManifest = {
  id: 'studio',
  version: '1.0.0',
  displayName: 'Studio',
  description: '',
  source: 'local',
  revision: 'one',
  enabled: true,
  status: 'ready',
  nodeKinds: [],
  actionBar: false,
  contextMenu: false,
  themes: [
    {
      id: 'dusk',
      title: 'Dusk',
      appearance: 'light',
      palette: { baseHue: 40, baseChroma: 0.02, accentHue: 330, accentChroma: 0.14, contrast: 0.5 },
      tokens: { '--cove-focus-ring': '#123456' },
    },
  ],
}

function Hook({ theme }: { theme: UiTheme }) {
  useApplyUiTheme(theme)
  return null
}

afterEach(() => {
  cleanup()
  state.plugins = []
  document.documentElement.removeAttribute('style')
  for (const key of ['coveTheme', 'coveThemeId', 'coveThemeBase', 'coveFamily']) {
    delete document.documentElement.dataset[key]
  }
})

it('generates a palette theme on the Cove family and removes it on switch', () => {
  state.plugins = [plugin]
  const { rerender } = render(<Hook theme="plugin:studio:dusk" />)
  const root = document.documentElement
  expect(root.dataset.coveThemeId).toBe('plugin:studio:dusk')
  expect(root.dataset.coveThemeBase).toBe('light')
  expect(root.dataset.coveFamily).toBe('cove')
  const style = document.querySelector<HTMLStyleElement>('style[data-cove-theme-palette]')
  expect(style?.dataset.coveThemePalette).toBe('plugin:studio:dusk')
  expect(style?.textContent).toMatch(/^@layer opencove \{/)
  expect(style?.textContent).toContain(
    `:root[data-cove-family='cove'][data-cove-theme-id="plugin:studio:dusk"][data-cove-theme='light'] {`,
  )
  // Manifest tokens still win over the generated palette.
  expect(root.style.getPropertyValue('--cove-focus-ring')).toBe('#123456')

  rerender(<Hook theme="dark" />)
  expect(document.querySelector('style[data-cove-theme-palette]')).toBeNull()
  expect(root.style.getPropertyValue('--cove-focus-ring')).toBe('')
})
