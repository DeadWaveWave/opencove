import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
  type AgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import { createTerminalDisplayProfileKey } from '../../../src/contexts/settings/domain/terminalDisplayCalibration'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'
import {
  clearTerminalClientDisplayCalibration,
  writeTerminalClientDisplayCalibration,
} from '../../../src/contexts/settings/presentation/renderer/terminalDisplayCalibrationStorage'
import type { AppUpdateState } from '../../../src/shared/contracts/dto'

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
      acc[provider] = {
        models: [],
        source: null,
        fetchedAt: null,
        isLoading: false,
        error: null,
      }
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

function renderSettingsPanel({
  settings = DEFAULT_AGENT_SETTINGS,
  onChange = () => undefined,
}: {
  settings?: AgentSettings
  onChange?: (settings: AgentSettings) => void
} = {}) {
  vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
    terminalProfiles: [],
    detectedDefaultTerminalProfileId: null,
    refreshTerminalProfiles: async () => undefined,
  })

  return render(
    <SettingsPanel
      settings={settings}
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

function createReference() {
  return {
    version: 1 as const,
    measurement: {
      fontSize: 13,
      fontFamily: null,
      lineHeight: 1,
      letterSpacing: 0,
      cols: 81,
      rows: 24,
      cssCellWidth: 7.5,
      cssCellHeight: 15,
      effectiveDpr: 2,
      windowDevicePixelRatio: 1,
      visualViewportScale: 1,
      runtime: 'desktop' as const,
      measuredAt: '2026-04-30T00:00:00.000Z',
    },
  }
}

describe('SettingsPanel terminal display controls', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    clearTerminalClientDisplayCalibration()
    vi.restoreAllMocks()
  })

  it('persists the automatic alignment toggle', () => {
    const onChange = vi.fn()
    renderSettingsPanel({ onChange })

    fireEvent.click(screen.getByTestId('settings-terminal-display-auto-calibration'))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      terminalDisplayAutoCalibrationEnabled: false,
    })
  })

  it('shows display match quality without exposing raw score', () => {
    const reference = createReference()
    writeTerminalClientDisplayCalibration({
      version: 1,
      profileKey: createTerminalDisplayProfileKey({
        terminalFontSize: 13,
        terminalFontFamily: null,
      }),
      fontSize: 13,
      lineHeight: 1,
      letterSpacing: 0,
      target: {
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      score: 0,
      measuredAt: '2026-04-30T00:00:00.000Z',
    })

    renderSettingsPanel({
      settings: { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: reference },
    })

    expect(screen.getByText(/Display match: Exact/)).toBeVisible()
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument()
  })
})
