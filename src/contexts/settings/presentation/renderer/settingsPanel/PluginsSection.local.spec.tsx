import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import * as registry from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { PluginsSection } from './PluginsSection'

vi.mock('@contexts/plugins/presentation/renderer/PluginNodePreview', () => ({
  PluginNodePreview: () => <div data-testid="isolated-preview" />,
}))
const plugin: PluginManifest = {
  id: 'music-test',
  displayName: 'Music',
  version: '1.0.0',
  description: 'Listen on your canvas.',
  nodeKinds: ['music'],
  source: 'local',
  author: 'Example author',
  actionBar: true,
  contextMenu: true,
  icon: { type: 'asset', path: './icon.svg' },
  enabled: true,
  status: 'ready',
  revision: 'test-revision',
}
const assets = {
  './cover.svg': 'data:image/svg+xml;base64,PHN2Zy8+',
  './icon.svg': 'data:image/svg+xml;base64,PHN2Zy8+',
}
let invoke = vi.fn()

beforeEach(async () => {
  await applyUiLanguage('en')
  vi.spyOn(registry, 'usePluginRegistry').mockReturnValue({ plugins: [plugin], error: null })
  vi.spyOn(registry, 'usePluginManifest').mockImplementation(id =>
    id === plugin.id ? plugin : null,
  )
  vi.spyOn(registry, 'changeInstalledPlugin').mockResolvedValue(undefined)
  invoke = vi.fn().mockResolvedValue({
    plugin,
    readme: '# Your music\n\n![Cover](./cover.svg)',
    assets,
    sourceDirectory: '/my-plugins/music',
    logs: ['Music backend ready'],
  })
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderSettings() {
  const onEnabled = vi.fn()
  const onContribution = vi.fn()
  render(
    <PluginsSection
      settings={{ ...DEFAULT_AGENT_SETTINGS, disabledPluginIds: [plugin.id] }}
      onChangePluginEnabled={onEnabled}
      onChangePluginContributionEnabled={onContribution}
    />,
  )
  return { onEnabled, onContribution }
}

describe('installed plugin management', () => {
  it('uses runtime enablement, local metadata, registered assets and Markdown without editing builtin preferences', async () => {
    const { onEnabled, onContribution } = renderSettings()
    expect(screen.getByText('Local plugin')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Enable Music' })).toBeChecked()
    fireEvent.click(screen.getByTestId('settings-plugin-details-music-test'))
    await screen.findByRole('heading', { name: 'Your music' })
    expect(screen.getByText('Example author')).toBeVisible()
    expect(screen.getByText('/my-plugins/music')).toBeVisible()
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', assets['./cover.svg'])
    expect(screen.getByTestId('isolated-preview')).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Music' }))
    await waitFor(() =>
      expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.setEnabled', {
        pluginId: plugin.id,
        enabled: false,
      }),
    )
    expect(onEnabled).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('switch', { name: 'Show in action bar' }))
    expect(onContribution).toHaveBeenCalledWith(plugin.id, 'actionBar', false)
  })

  it('leaves the enabled display unchanged on runtime failure and surfaces the error', async () => {
    vi.mocked(registry.changeInstalledPlugin).mockRejectedValueOnce(
      new Error('Backend unavailable'),
    )
    const { onEnabled } = renderSettings()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Music' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend unavailable')
    expect(screen.getByRole('checkbox', { name: 'Enable Music' })).toBeChecked()
    expect(onEnabled).not.toHaveBeenCalled()
  })

  it('reloads the installed source and requires explicit confirmation before unregistering it', async () => {
    renderSettings()
    fireEvent.click(screen.getByTestId('settings-plugin-details-music-test'))
    fireEvent.click(screen.getByTestId('settings-plugin-reload'))
    await waitFor(() =>
      expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.reload', {
        pluginId: plugin.id,
      }),
    )
    await waitFor(() => expect(screen.getByTestId('settings-plugin-uninstall')).toBeEnabled())
    fireEvent.click(screen.getByTestId('settings-plugin-uninstall'))
    expect(registry.changeInstalledPlugin).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText(
        'Source files, saved data, and canvas nodes stay available for reinstalling.',
      ),
    ).toBeVisible()
    fireEvent.click(screen.getByTestId('settings-plugin-confirm-uninstall'))
    await waitFor(() =>
      expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.uninstall', {
        pluginId: plugin.id,
      }),
    )
    await waitFor(() =>
      expect(screen.queryByTestId('settings-plugin-detail-music-test')).toBeNull(),
    )
  })
})
