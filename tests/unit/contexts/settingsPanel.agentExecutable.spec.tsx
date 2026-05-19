import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { AppUpdateState } from '../../../src/shared/contracts/dto'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'

function createUpdateState(): AppUpdateState {
  return {
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
  }
}

function createModelCatalog() {
  return {
    'claude-code': { models: [], source: null, fetchedAt: null, isLoading: false, error: null },
    codex: { models: [], source: null, fetchedAt: null, isLoading: false, error: null },
    opencode: { models: [], source: null, fetchedAt: null, isLoading: false, error: null },
    gemini: { models: [], source: null, fetchedAt: null, isLoading: false, error: null },
  }
}

function mockTerminalProfiles(): void {
  vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
    terminalProfiles: [],
    detectedDefaultTerminalProfileId: null,
    refreshTerminalProfiles: async () => undefined,
  })
}

function renderSettingsPanel(): void {
  render(
    <SettingsPanel
      settings={DEFAULT_AGENT_SETTINGS}
      updateState={createUpdateState()}
      modelCatalogByProvider={createModelCatalog()}
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
    />,
  )
}

describe('SettingsPanel agent executable installation', () => {
  afterEach(() => {
    delete (window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi
    vi.restoreAllMocks()
  })

  it('installs an unavailable agent provider from the settings panel', async () => {
    const listInstalledProviders = vi
      .fn()
      .mockResolvedValueOnce({
        providers: [],
        availabilityByProvider: {
          'claude-code': {
            provider: 'claude-code',
            command: 'claude',
            status: 'unavailable' as const,
            executablePath: null,
            source: null,
            diagnostics: [],
          },
          codex: {
            provider: 'codex',
            command: 'codex',
            status: 'unavailable' as const,
            executablePath: null,
            source: null,
            diagnostics: [],
          },
          opencode: {
            provider: 'opencode',
            command: 'opencode',
            status: 'unavailable' as const,
            executablePath: null,
            source: null,
            diagnostics: [],
          },
          gemini: {
            provider: 'gemini',
            command: 'gemini',
            status: 'unavailable' as const,
            executablePath: null,
            source: null,
            diagnostics: [],
          },
        },
        fetchedAt: '2026-04-30T00:00:00.000Z',
      })
      .mockResolvedValue({
        providers: ['codex'],
        availabilityByProvider: {
          'claude-code': {
            provider: 'claude-code',
            command: 'claude',
            status: 'unavailable' as const,
            executablePath: null,
            source: null,
            diagnostics: [],
          },
          codex: {
            provider: 'codex',
            command: 'codex',
            status: 'available' as const,
            executablePath: '/Users/tester/.npm-global/bin/codex',
            source: 'shell_env_path' as const,
            diagnostics: [],
          },
          opencode: {
            provider: 'opencode',
            command: 'opencode',
            status: 'unavailable' as const,
            executablePath: null,
            source: null,
            diagnostics: [],
          },
          gemini: {
            provider: 'gemini',
            command: 'gemini',
            status: 'unavailable' as const,
            executablePath: null,
            source: null,
            diagnostics: [],
          },
        },
        fetchedAt: '2026-04-30T00:00:01.000Z',
      })
    const installProvider = vi.fn(async () => ({
      provider: 'codex' as const,
      packageName: '@openai/codex',
      availability: {
        provider: 'codex' as const,
        command: 'codex',
        status: 'available' as const,
        executablePath: '/Users/tester/.npm-global/bin/codex',
        source: 'shell_env_path' as const,
        diagnostics: [],
      },
      stdout: '',
      stderr: '',
    }))

    ;(window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi = {
      agent: {
        listInstalledProviders,
        installProvider,
      },
    } as Window['opencoveApi']

    mockTerminalProfiles()
    renderSettingsPanel()

    fireEvent.click(screen.getByTestId('settings-section-nav-agent'))

    await waitFor(() => {
      expect(screen.getByTestId('settings-agent-executable-install-codex')).toHaveTextContent(
        'Install',
      )
    })

    fireEvent.click(screen.getByTestId('settings-agent-executable-install-codex'))

    await waitFor(() => {
      expect(installProvider).toHaveBeenCalledWith({ provider: 'codex' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('settings-agent-executable-install-codex')).toHaveTextContent(
        'Installed',
      )
    })
  })
})
