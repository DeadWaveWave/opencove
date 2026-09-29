import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as builtins from '../../application/builtinPlugins'
import type { PluginIconDeclaration, PluginManifest } from '../../domain/pluginTypes'
import * as assets from './pluginAssets'
import { PluginIcon } from './PluginIcon'
import { NodeKindIcon } from '@contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'

const gitBoard = builtins.getBuiltinPluginManifest('git-board')!
const initialTheme = document.documentElement.dataset.coveTheme

function declareIcon(icon: PluginIconDeclaration | undefined): void {
  const manifest: PluginManifest = { ...gitBoard, icon }
  vi.spyOn(builtins, 'getBuiltinPluginManifest').mockReturnValue(manifest)
}

function setTheme(theme: 'dark' | 'light'): void {
  act(() => {
    document.documentElement.dataset.coveTheme = theme
    window.dispatchEvent(new Event('opencove-theme-changed'))
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (initialTheme === undefined) {
    delete document.documentElement.dataset.coveTheme
  } else {
    document.documentElement.dataset.coveTheme = initialTheme
  }
})

describe('PluginIcon declarations', () => {
  it('shares the manifest glyph between settings-sized and node-sized identities', () => {
    const { container } = render(
      <>
        <PluginIcon pluginId="git-board" size={24} className="settings-glyph" />
        <NodeKindIcon kind="plugin" pluginId="git-board" />
      </>,
    )
    const icons = container.querySelectorAll('[data-cove-plugin-icon="git-board"]')
    expect(icons).toHaveLength(2)
    expect(icons[0]).toHaveAttribute('width', '24')
    expect(icons[1]).toHaveAttribute('width', '16')
    expect(icons[1]).toHaveClass('cove-node-kind-icon')
    for (const icon of icons) {
      expect(icon).toHaveClass('lucide-git-branch')
      expect(icon).toHaveAttribute('stroke', 'currentColor')
    }
  })

  it.each(['png', 'webp', 'svg'])(
    'renders a registered %s as an image, without inline markup',
    ext => {
      declareIcon({ type: 'asset', path: `./icon.${ext}` })
      vi.spyOn(assets, 'getPluginAssets').mockReturnValue({
        [`./icon.${ext}`]: `/bundled/icon.${ext}`,
      })
      const { container } = render(<PluginIcon pluginId="git-board" size={24} />)
      const image = container.querySelector('img')
      expect(image).toHaveAttribute('src', `/bundled/icon.${ext}`)
      expect(image).toHaveAttribute('width', '24')
      expect(image).toHaveAttribute('alt', '')
      expect(image).toHaveAttribute('draggable', 'false')
      expect(container.querySelector('svg')).toBeNull()
    },
  )

  it('follows the existing resolved-theme event and cleans up the subscription', () => {
    setTheme('dark')
    declareIcon({ type: 'asset', path: './base.svg', light: './light.svg', dark: './dark.svg' })
    vi.spyOn(assets, 'getPluginAssets').mockReturnValue({
      './base.svg': '/bundled/base.svg',
      './light.svg': '/bundled/light.svg',
      './dark.svg': '/bundled/dark.svg',
    })
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const { container, unmount } = render(<PluginIcon pluginId="git-board" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/bundled/dark.svg')
    setTheme('light')
    expect(container.querySelector('img')).toHaveAttribute('src', '/bundled/light.svg')
    unmount()
    expect(removeListener).toHaveBeenCalledWith('opencove-theme-changed', expect.any(Function))
  })

  it('uses the base image for an absent variant and falls back when image loading fails', () => {
    setTheme('light')
    declareIcon({ type: 'asset', path: './base.svg', dark: './unregistered.svg' })
    vi.spyOn(assets, 'getPluginAssets').mockReturnValue({ './base.svg': '/bundled/base.svg' })
    const { container } = render(<PluginIcon pluginId="git-board" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/bundled/base.svg')
    setTheme('dark')
    expect(container.querySelector('img')).toHaveAttribute('src', '/bundled/base.svg')
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('[data-plugin-icon-kind="fallback"]')).toHaveClass(
      'lucide-puzzle',
    )
    expect(container.querySelector('img')).toBeNull()
  })

  it.each(['file:///private/icon.svg', 'https://example.com/icon.svg', '__proto__'])(
    'never loads an unregistered manifest path: %s',
    path => {
      declareIcon({ type: 'asset', path })
      vi.spyOn(assets, 'getPluginAssets').mockReturnValue({})
      const { container } = render(<PluginIcon pluginId="git-board" />)
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('svg')).toHaveAttribute('data-plugin-icon-kind', 'fallback')
    },
  )

  it('uses the host fallback for a missing declaration or missing plugin', () => {
    declareIcon(undefined)
    const { container, rerender } = render(<PluginIcon pluginId="git-board" />)
    expect(container.querySelector('svg')).toHaveClass('lucide-puzzle')
    vi.mocked(builtins.getBuiltinPluginManifest).mockReturnValue(null)
    rerender(<PluginIcon pluginId="missing-plugin" />)
    expect(container.querySelector('svg')).toHaveClass('lucide-puzzle')
  })
})
