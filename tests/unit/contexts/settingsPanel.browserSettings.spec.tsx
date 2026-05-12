import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'

function mockTerminalProfiles(
  overrides: Partial<ReturnType<typeof terminalProfilesHook.useTerminalProfiles>> = {},
) {
  vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
    terminalProfiles: [],
    detectedDefaultTerminalProfileId: null,
    refreshTerminalProfiles: async () => undefined,
    ...overrides,
  })
}

function renderSettingsPanel(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  return render(
    <SettingsPanel
      settings={{
        ...DEFAULT_AGENT_SETTINGS,
        websiteWindowPolicy: {
          ...DEFAULT_AGENT_SETTINGS.websiteWindowPolicy,
          enabled: true,
        },
      }}
      updateState={{
        policy: DEFAULT_AGENT_SETTINGS.updatePolicy,
        channel: DEFAULT_AGENT_SETTINGS.updateChannel,
        currentVersion: '0.2.0',
        status: 'idle',
        latestVersion: null,
        releaseName: null,
        releaseDate: null,
        releaseNotesUrl: null,
        downloadPercent: null,
        downloadedBytes: null,
        totalBytes: null,
        checkedAt: null,
        message: null,
      }}
      modelCatalogByProvider={
        {} as React.ComponentProps<typeof SettingsPanel>['modelCatalogByProvider']
      }
      workspaces={[]}
      onWorkspaceWorktreesRootChange={() => undefined}
      onWorkspaceEnvironmentVariablesChange={() => undefined}
      isFocusNodeTargetZoomPreviewing={false}
      onFocusNodeTargetZoomPreviewChange={() => undefined}
      onChange={() => undefined}
      onCheckForUpdates={() => undefined}
      onDownloadUpdate={() => undefined}
      onInstallUpdate={() => undefined}
      onClose={() => undefined}
      {...overrides}
    />,
  )
}

describe('SettingsPanel browser settings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('updates browser mode and search engine from experimental settings', () => {
    const onChange = vi.fn()
    mockTerminalProfiles()
    renderSettingsPanel({ onChange })

    fireEvent.click(screen.getByTestId('settings-section-nav-experimental'))
    fireEvent.click(screen.getByTestId('settings-website-window-default-mode-trigger'))
    fireEvent.click(screen.getByRole('option', { name: 'Web-compatible viewer' }))
    fireEvent.click(screen.getByTestId('settings-browser-search-engine-trigger'))
    fireEvent.click(screen.getByRole('option', { name: 'DuckDuckGo' }))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      websiteWindowPolicy: {
        ...DEFAULT_AGENT_SETTINGS.websiteWindowPolicy,
        enabled: true,
      },
      browserDefaultMode: 'iframe',
    })
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      websiteWindowPolicy: {
        ...DEFAULT_AGENT_SETTINGS.websiteWindowPolicy,
        enabled: true,
      },
      browserSearchEngine: 'duckduckgo',
    })
  })
})
