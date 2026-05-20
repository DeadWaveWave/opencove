import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
} from '../../../src/contexts/settings/domain/agentSettings'
import type { AppUpdateState } from '../../../src/shared/contracts/dto'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'

function createModelCatalog() {
  return AGENT_PROVIDERS.reduce<
    Record<
      AgentProvider,
      {
        models: string[]
        source: string | null
        fetchedAt: string | null
        isLoading: boolean
        error: string | null
      }
    >
  >(
    (acc, provider) => {
      acc[provider] = { models: [], source: null, fetchedAt: null, isLoading: false, error: null }
      return acc
    },
    {} as Record<
      AgentProvider,
      {
        models: string[]
        source: string | null
        fetchedAt: string | null
        isLoading: boolean
        error: string | null
      }
    >,
  )
}

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

function mockTerminalProfiles() {
  vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
    terminalProfiles: [],
    detectedDefaultTerminalProfileId: null,
    refreshTerminalProfiles: async () => undefined,
  })
}

function renderSettingsPanel(onChange: React.ComponentProps<typeof SettingsPanel>['onChange']) {
  return render(
    <SettingsPanel
      settings={DEFAULT_AGENT_SETTINGS}
      updateState={createUpdateState()}
      modelCatalogByProvider={createModelCatalog()}
      workspaces={[]}
      onWorkspaceWorktreesRootChange={() => undefined}
      onWorkspaceEnvironmentVariablesChange={() => undefined}
      isFocusNodeTargetZoomPreviewing={false}
      onFocusNodeTargetZoomPreviewChange={() => undefined}
      onChange={onChange}
      onCheckForUpdates={() => undefined}
      onDownloadUpdate={() => undefined}
      onInstallUpdate={() => undefined}
      onClose={() => undefined}
    />,
  )
}

describe('SettingsPanel agent configure panel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi
  })

  it('configures model and environment from the agent list', () => {
    const onChange = vi.fn()
    mockTerminalProfiles()
    renderSettingsPanel(onChange)

    fireEvent.click(screen.getByTestId('settings-section-nav-agent'))
    fireEvent.click(screen.getByTestId('settings-agent-configure-codex'))
    expect(screen.getByTestId('settings-agent-configure-panel-codex')).toContainElement(
      screen.getByTestId('settings-custom-model-enabled-codex'),
    )

    fireEvent.click(screen.getByTestId('settings-agent-env-add-codex'))
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      agentEnvByProvider: {
        ...DEFAULT_AGENT_SETTINGS.agentEnvByProvider,
        codex: [expect.objectContaining({ enabled: true, key: '', value: '' })],
      },
    })
  })
})
