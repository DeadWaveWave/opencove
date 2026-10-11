import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { UiTheme } from '@contexts/settings/domain/uiSettings'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import type { PluginDetails } from '@contexts/plugins/domain/pluginRuntimeTypes'
import { readThemeMotion } from '@contexts/plugins/presentation/renderer/themeMotion'
import { pluginThemeContext } from '@contexts/plugins/presentation/renderer/pluginThemeContext'
import { useApplyUiTheme } from './useApplyUiTheme'

const state = vi.hoisted(() => ({
  plugins: [] as PluginManifest[],
  detail: null as PluginDetails | null,
  error: null as string | null,
}))
vi.mock('@contexts/plugins/presentation/renderer/usePluginRegistry', () => ({
  usePluginRegistry: () => state,
}))
vi.mock('@contexts/plugins/presentation/renderer/usePluginDetails', () => ({
  usePluginDetails: () => ({ detail: state.detail, error: state.error }),
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
      id: 'night',
      title: 'Night',
      appearance: 'dark',
      extends: 'pixel',
      tokens: { '--cove-accent': '#77aaff' },
      stylesheet: 'theme.css',
      typography: { fontFamily: 'Studio Sans, sans-serif' },
      metrics: { headerHeight: 42, radius: 12 },
      motion: { fold: { durationMs: 410 } },
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
  state.detail = null
  state.error = null
  document.documentElement.removeAttribute('style')
  for (const key of ['coveTheme', 'coveThemeId', 'coveThemeBase']) {
    delete document.documentElement.dataset[key]
  }
})
it('uses the foundation while loading, publishes immutable assets and cleans every override on switch', () => {
  state.plugins = [plugin]
  const { rerender } = render(<Hook theme="plugin:studio:night" />)
  expect(document.documentElement.dataset.coveThemeId).toBe('pixel')
  expect(document.querySelector('[data-cove-theme-stylesheet]')).toBeNull()
  state.detail = {
    plugin,
    sourceDirectory: '/source',
    readme: '',
    assets: {},
    logs: [],
    themeStyles: {
      night: ':root[data-cove-theme-id="plugin:studio:night"] { --studio-proof: 1; }',
    },
    themeFonts: { night: [{ family: 'Studio Sans', source: 'local("Arial")' }] },
  }
  rerender(<Hook theme="plugin:studio:night" />)
  const root = document.documentElement
  expect(root.dataset.coveThemeId).toBe('plugin:studio:night')
  expect(root.dataset.coveThemeBase).toBe('pixel')
  expect(root.style.getPropertyValue('--cove-node-header-height')).toBe('42px')
  expect(readThemeMotion().fold?.durationMs).toBe(410)
  expect(pluginThemeContext()).toMatchObject({
    themeVersion: 1,
    themeId: 'plugin:studio:night',
    baseThemeId: 'pixel',
    fonts: [{ family: 'Studio Sans' }],
  })
  expect(document.querySelectorAll('[data-cove-theme-stylesheet]')).toHaveLength(1)
  rerender(<Hook theme="pixel-light" />)
  expect(root.dataset.coveThemeBase).toBe('pixel-light')
  expect(root.style.getPropertyValue('--cove-node-header-height')).toBe('')
  expect(root.style.getPropertyValue('--cove-font-ui')).toBe('')
  expect(document.querySelector('[data-cove-theme-stylesheet]')).toBeNull()
  expect(readThemeMotion()).toEqual({})
  expect(pluginThemeContext().fonts).toEqual([])
})
it('falls back on resource failure and reapplies the chosen theme when resources recover', () => {
  state.plugins = [plugin]
  state.error = 'Worker unavailable'
  const { rerender } = render(<Hook theme="plugin:studio:night" />)
  expect(document.documentElement.dataset.coveThemeId).toBe('pixel')
  state.error = null
  state.detail = {
    plugin,
    sourceDirectory: '',
    readme: '',
    assets: {},
    logs: [],
    themeStyles: { night: '' },
  }
  rerender(<Hook theme="plugin:studio:night" />)
  expect(document.documentElement.dataset.coveThemeId).toBe('plugin:studio:night')
  state.plugins = [{ ...plugin, enabled: false }]
  rerender(<Hook theme="plugin:studio:night" />)
  expect(document.documentElement.dataset.coveThemeId).toBe('pixel')
  expect(document.querySelector('[data-cove-theme-stylesheet]')).toBeNull()
})
