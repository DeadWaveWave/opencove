import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useApplyUiTheme } from './useApplyUiTheme'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import { readTerminalAnsiTheme } from '@contexts/workspace/presentation/renderer/components/terminalNode/terminalAnsiTheme'

const state = vi.hoisted(() => ({ plugins: [] as PluginManifest[] }))
vi.mock('@contexts/plugins/presentation/renderer/usePluginRegistry', () => ({
  usePluginRegistry: () => state,
}))
function Hook() {
  useApplyUiTheme('plugin:colors:dawn')
  return null
}
afterEach(() => {
  cleanup()
  state.plugins = []
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-cove-theme')
  document.documentElement.removeAttribute('data-cove-theme-id')
  document.documentElement.removeAttribute('data-cove-theme-base')
  document.documentElement.removeAttribute('data-cove-family')
})
it('applies color-only light tokens through terminal readers and removes overrides on fallback', () => {
  const plugin: PluginManifest = {
    id: 'colors',
    version: '1.0.0',
    displayName: 'Colors',
    description: '',
    enabled: true,
    status: 'ready',
    nodeKinds: [],
    actionBar: false,
    contextMenu: false,
    themes: [
      {
        id: 'dawn',
        title: 'Dawn',
        appearance: 'light',
        tokens: {
          '--cove-terminal-ansi-red': '#a12233',
          '--cove-pixel-mint': '#235544',
          '--cove-accent': '#224488',
        },
      },
    ],
  }
  state.plugins = [plugin]
  const { rerender } = render(<Hook />)
  expect(document.documentElement.dataset.coveTheme).toBe('light')
  // Without `extends`, a plugin theme builds on the Cove foundation of its appearance.
  expect(document.documentElement.dataset.coveThemeBase).toBe('light')
  expect(document.documentElement.dataset.coveFamily).toBe('cove')
  expect(readTerminalAnsiTheme(getComputedStyle(document.documentElement)).red).toBe('#a12233')
  expect(document.documentElement.style.getPropertyValue('--cove-pixel-mint')).toBe('#235544')
  state.plugins = [{ ...plugin, enabled: false }]
  rerender(<Hook />)
  expect(document.documentElement.dataset.coveThemeId).toBe('dark')
  expect(document.documentElement.dataset.coveFamily).toBe('cove')
  expect(readTerminalAnsiTheme(getComputedStyle(document.documentElement)).red).toBeUndefined()
  expect(document.documentElement.style.getPropertyValue('--cove-pixel-mint')).toBe('')
  state.plugins = [plugin]
  rerender(<Hook />)
  expect(document.documentElement.dataset.coveThemeId).toBe('plugin:colors:dawn')
})
