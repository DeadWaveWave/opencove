import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { examplePlugin, exampleDetails } from './pluginPresentationTestFixture'
import type { PluginIconDeclaration, PluginManifest } from '../../domain/pluginTypes'
import * as details from './usePluginDetails'
import * as registry from './usePluginRegistry'
import { PluginIcon } from './PluginIcon'
import { NodeKindIcon } from '@contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'

const fixture = examplePlugin
const initialTheme = document.documentElement.dataset.coveTheme

function declareIcon(icon: PluginIconDeclaration | undefined): void {
  const manifest: PluginManifest = { ...fixture, icon }
  vi.spyOn(registry, 'usePluginManifest').mockReturnValue(manifest)
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
    declareIcon(examplePlugin.icon)
    const { container } = render(
      <>
        <PluginIcon pluginId="example-tool" size={24} className="settings-glyph" />
        <NodeKindIcon kind="plugin" pluginId="example-tool" />
      </>,
    )
    const icons = container.querySelectorAll('[data-cove-plugin-icon="example-tool"]')
    expect(icons).toHaveLength(2)
    expect(icons[0]).toHaveAttribute('width', '24')
    expect(icons[1]).toHaveAttribute('width', '16')
    expect(icons[1]).toHaveClass('cove-node-kind-icon')
    for (const icon of icons) {
      expect(icon).toHaveClass('lucide-puzzle')
      expect(icon).toHaveAttribute('stroke', 'currentColor')
    }
  })

  it.each(['png', 'webp', 'svg'])(
    'renders a registered %s as an image, without inline markup',
    ext => {
      declareIcon({ type: 'asset', path: `./icon.${ext}` })
      vi.spyOn(details, 'usePluginDetails').mockReturnValue({
        error: null,
        detail: {
          ...exampleDetails,
          assets: {
            [`./icon.${ext}`]: `/bundled/icon.${ext}`,
          },
        },
      })
      const { container } = render(<PluginIcon pluginId="example-tool" size={24} />)
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
    vi.spyOn(details, 'usePluginDetails').mockReturnValue({
      error: null,
      detail: {
        ...exampleDetails,
        assets: {
          './base.svg': '/bundled/base.svg',
          './light.svg': '/bundled/light.svg',
          './dark.svg': '/bundled/dark.svg',
        },
      },
    })
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const { container, unmount } = render(<PluginIcon pluginId="example-tool" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/bundled/dark.svg')
    setTheme('light')
    expect(container.querySelector('img')).toHaveAttribute('src', '/bundled/light.svg')
    unmount()
    expect(removeListener).toHaveBeenCalledWith('opencove-theme-changed', expect.any(Function))
  })

  it('uses the base image for an absent variant and falls back when image loading fails', () => {
    setTheme('light')
    declareIcon({ type: 'asset', path: './base.svg', dark: './unregistered.svg' })
    vi.spyOn(details, 'usePluginDetails').mockReturnValue({
      error: null,
      detail: { ...exampleDetails, assets: { './base.svg': '/bundled/base.svg' } },
    })
    const { container } = render(<PluginIcon pluginId="example-tool" />)
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
      vi.spyOn(details, 'usePluginDetails').mockReturnValue({
        error: null,
        detail: { ...exampleDetails, assets: {} },
      })
      const { container } = render(<PluginIcon pluginId="example-tool" />)
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('svg')).toHaveAttribute('data-plugin-icon-kind', 'fallback')
    },
  )

  it('uses the host fallback for a missing declaration or missing plugin', () => {
    declareIcon(undefined)
    const { container, rerender } = render(<PluginIcon pluginId="example-tool" />)
    expect(container.querySelector('svg')).toHaveClass('lucide-puzzle')
    vi.mocked(registry.usePluginManifest).mockReturnValue(null)
    rerender(<PluginIcon pluginId="missing-plugin" />)
    expect(container.querySelector('svg')).toHaveClass('lucide-puzzle')
  })
})
