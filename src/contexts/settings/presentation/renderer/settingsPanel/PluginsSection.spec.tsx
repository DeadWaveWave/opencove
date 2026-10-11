import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import {
  examplePlugin,
  exampleDetails,
} from '@contexts/plugins/presentation/renderer/pluginPresentationTestFixture'
import * as registry from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import * as details from '@contexts/plugins/presentation/renderer/usePluginDetails'
import { PluginsSection } from './PluginsSection'
import { PluginContributionControls } from './PluginContributionControls'

vi.mock('@contexts/plugins/presentation/renderer/PluginNodePreview', () => ({
  PluginNodePreview: () => <div data-testid="plugin-node-preview" />,
}))
beforeEach(async () => {
  await applyUiLanguage('en')
  vi.spyOn(registry, 'usePluginRegistry').mockReturnValue({ plugins: [examplePlugin], error: null })
  vi.spyOn(registry, 'usePluginManifest').mockReturnValue(examplePlugin)
  vi.spyOn(registry, 'changeInstalledPlugin').mockResolvedValue(undefined)
  vi.spyOn(details, 'usePluginDetails').mockReturnValue({ detail: exampleDetails, error: null })
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke: vi.fn().mockResolvedValue(null) } })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  void applyUiLanguage('en')
})
function renderSettings() {
  const enabled = vi.fn()
  const contribution = vi.fn()
  const result = render(
    <div className="settings-panel__content">
      <PluginsSection
        settings={DEFAULT_AGENT_SETTINGS}
        onChangePluginEnabled={enabled}
        onChangePluginContributionEnabled={contribution}
      />
    </div>,
  )
  return { ...result, enabled, contribution }
}

describe('PluginsSection', () => {
  it.each([
    ['en', 'Enable Example Tool', 'Local plugin'],
    ['zh-CN', '启用 Example Tool', '本地插件'],
  ] as const)(
    'shows installed metadata and changes runtime enablement in %s',
    async (language, label, source) => {
      await applyUiLanguage(language)
      const { enabled } = renderSettings()
      expect(screen.getByRole('heading', { name: 'Example Tool', level: 4 })).toBeVisible()
      expect(screen.getByText(source)).toBeVisible()
      fireEvent.click(screen.getByRole('checkbox', { name: label }))
      await waitFor(() =>
        expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.setEnabled', {
          pluginId: examplePlugin.id,
          enabled: false,
        }),
      )
      expect(enabled).not.toHaveBeenCalled()
    },
  )

  it('opens installed Markdown and preview, then restores list focus and scroll', () => {
    const { container } = renderSettings()
    const scroller = container.firstElementChild as HTMLElement
    scroller.scrollTop = 128
    fireEvent.click(screen.getByTestId('settings-plugin-details-example-tool'))
    expect(screen.getByRole('heading', { name: 'Example Tool', level: 3 })).toHaveFocus()
    expect(scroller.scrollTop).toBe(0)
    expect(screen.getByTestId('plugin-node-preview')).toBeVisible()
    expect(screen.getByRole('img', { name: 'Example' })).toHaveAttribute('src', '/example.svg')
    fireEvent.click(screen.getByTestId('settings-plugin-back'))
    expect(screen.getByTestId('settings-plugin-details-example-tool')).toHaveFocus()
    expect(scroller.scrollTop).toBe(128)
  })

  it.each([true, false])(
    'keeps a theme-only detail free of node entries and preview while enabled=%s',
    async enabled => {
      const plugin: PluginManifest = {
        ...examplePlugin,
        nodeKinds: [],
        actionBar: false,
        contextMenu: false,
        hasPreview: false,
        themes: [{ id: 'night', title: 'Night', appearance: 'dark', tokens: {} }],
        enabled,
        status: enabled ? 'ready' : 'disabled',
      }
      vi.mocked(registry.usePluginRegistry).mockReturnValue({ plugins: [plugin], error: null })
      vi.mocked(registry.usePluginManifest).mockReturnValue(plugin)
      vi.mocked(details.usePluginDetails).mockReturnValue({
        detail: { ...exampleDetails, plugin },
        error: null,
      })
      renderSettings()
      fireEvent.click(screen.getByTestId('settings-plugin-details-example-tool'))

      expect(screen.getByText('Themes')).toBeVisible()
      expect(screen.getByTestId('plugin-readme')).toHaveTextContent('Your tool')
      expect(screen.queryByText('Canvas node')).toBeNull()
      expect(screen.queryByText('Action bar')).toBeNull()
      expect(screen.queryByText('Right-click menu')).toBeNull()
      expect(screen.queryByRole('group', { name: 'Show in' })).toBeNull()
      expect(screen.queryByTestId('plugin-node-preview')).toBeNull()
      expect(screen.getByTestId('settings-plugin-reload')).toBeVisible()

      fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Example Tool' }))
      await waitFor(() =>
        expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.setEnabled', {
          pluginId: plugin.id,
          enabled: !enabled,
        }),
      )
    },
  )

  it('retains declared node entries when a plugin also contributes themes', () => {
    const plugin: PluginManifest = {
      ...examplePlugin,
      themes: [{ id: 'night', title: 'Night', appearance: 'dark', tokens: {} }],
    }
    vi.mocked(registry.usePluginRegistry).mockReturnValue({ plugins: [plugin], error: null })
    renderSettings()
    fireEvent.click(screen.getByTestId('settings-plugin-details-example-tool'))
    expect(screen.getByText('Themes')).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Show in action bar' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Show in right-click menu' })).toBeChecked()
    expect(screen.getByTestId('plugin-node-preview')).toBeVisible()
  })

  it.each([
    ['en', 'Plugin library', 'Your first plugin, with Hello Clock'],
    ['zh-CN', '插件文档库', '用 Hello Clock 制作第一个插件'],
  ] as const)(
    'reads localized documentation without starting or changing a plugin in %s',
    async (language, title, articleTitle) => {
      await applyUiLanguage(language)
      const { enabled, contribution } = renderSettings()
      fireEvent.click(screen.getByTestId('settings-plugins-documentation'))
      expect(screen.getByRole('heading', { name: title })).toHaveFocus()
      fireEvent.click(screen.getByTestId('plugin-library-build'))
      expect(screen.getByRole('heading', { name: articleTitle })).toBeVisible()
      expect(screen.getByTestId('plugin-readme')).toHaveTextContent('opencove plugin guide')
      fireEvent.click(screen.getByTestId('plugin-library-back'))
      expect(screen.getByTestId('plugin-library-build')).toHaveFocus()
      fireEvent.click(screen.getByTestId('plugin-library-back'))
      expect(screen.getByTestId('settings-plugins-documentation')).toHaveFocus()
      expect(registry.changeInstalledPlugin).not.toHaveBeenCalled()
      expect(enabled).not.toHaveBeenCalled()
      expect(contribution).not.toHaveBeenCalled()
    },
  )

  it('shows a useful empty shelf with documentation and installation actions', () => {
    vi.mocked(registry.usePluginRegistry).mockReturnValue({ plugins: [], error: null })
    renderSettings()
    expect(screen.getByTestId('settings-plugins-empty')).toBeVisible()
    expect(screen.queryByTestId('settings-plugin-details-git-board')).toBeNull()
    fireEvent.click(screen.getByTestId('settings-plugins-install'))
    expect(screen.getByTestId('settings-plugin-install-panel')).toBeVisible()
  })

  it('copies the actual offline guide command and reports clipboard failures', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('opencoveApi', { clipboard: { writeText } })
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Copy guide command' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Command copied'))
    expect(writeText).toHaveBeenCalledWith('opencove plugin guide')
    writeText.mockRejectedValueOnce(new Error('unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy guide command' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy'))
  })

  it('uses the whole contribution tile as an accessible switch and only shows declared entries', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <PluginContributionControls
        plugin={examplePlugin}
        settings={{ pluginContributions: {} }}
        onChange={onChange}
      />,
    )
    const tile = screen.getByTestId('settings-plugin-contribution-tile-actionBar-example-tool')
    expect(tile.tagName).toBe('LABEL')
    expect(screen.getByRole('switch', { name: 'Show in action bar' })).toHaveAccessibleDescription(
      'On the right side of the canvas',
    )
    fireEvent.click(tile)
    expect(onChange).toHaveBeenLastCalledWith('actionBar', false)
    rerender(
      <PluginContributionControls
        plugin={{ ...examplePlugin, actionBar: false, contextMenu: false }}
        settings={{ pluginContributions: {} }}
        onChange={onChange}
      />,
    )
    expect(screen.queryByRole('group', { name: 'Show in' })).toBeNull()
  })
})
