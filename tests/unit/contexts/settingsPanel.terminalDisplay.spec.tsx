import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function openAppearanceSettings(): void {
  fireEvent.click(screen.getByTestId('settings-section-nav-appearance'))
}

function createReference() {
  return {
    version: 1 as const,
    capture: { algorithmVersion: 1 as const, rendererKind: 'webgl' as const },
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
    vi.unstubAllGlobals()
  })

  it('persists the automatic reference setup toggle', () => {
    const onChange = vi.fn()
    renderSettingsPanel({ onChange })
    openAppearanceSettings()

    fireEvent.click(screen.getByTestId('settings-terminal-display-auto-reference'))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      terminalDisplayAutoReferenceEnabled: false,
    })
  })

  it('persists the automatic calibration compensation toggle', () => {
    const onChange = vi.fn()
    renderSettingsPanel({ onChange })
    openAppearanceSettings()

    fireEvent.click(screen.getByTestId('settings-terminal-display-compensation'))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      terminalDisplayCalibrationCompensationEnabled: false,
    })
  })

  it('does not present a metadata-less legacy adjustment as verified', () => {
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
    openAppearanceSettings()

    expect(screen.getByText(/cannot safely match the current target/i)).toBeVisible()
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument()
  })

  it('keeps an unapplied low-confidence adjustment visible and clearable', () => {
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
      measured: {
        cols: 84,
        rows: 24,
        cssCellWidth: 7.8,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      score: 3032.5,
      measuredAt: '2026-09-01T00:00:00.000Z',
    })

    renderSettingsPanel({
      settings: { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: reference },
    })
    openAppearanceSettings()

    expect(screen.getByText(/cannot safely match the current target/i)).toBeVisible()
    const reset = screen.getByTestId('settings-terminal-display-reset')
    expect(reset).toBeEnabled()

    fireEvent.click(reset)
    expect(screen.getByText(/No saved adjustment for this device/i)).toBeVisible()
    expect(reset).toBeDisabled()
  })

  it('copies reference validity, suppression, renderer inventory, and applicability diagnostics', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const currentReference = createReference()
    const legacyReference = {
      version: currentReference.version,
      measurement: currentReference.measurement,
    }
    renderSettingsPanel({
      settings: { ...DEFAULT_AGENT_SETTINGS, terminalDisplayReference: legacyReference },
    })
    openAppearanceSettings()

    fireEvent.click(screen.getByTestId('settings-terminal-display-copy-diagnostics'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

    const payload = JSON.parse(String(writeText.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(payload).toMatchObject({
      referenceMatchesCurrentProfile: true,
      referenceUsesCurrentCalibrationAlgorithm: false,
      referenceCapture: null,
      mountedRendererInventory: { dom: 0, webgl: 0 },
      clientCalibrationSuppression: null,
      clientCalibrationInspection: {
        referencePresent: true,
        referenceMatchesProfile: true,
        referenceUsesCurrentAlgorithm: false,
        applicableCalibrationPresent: false,
      },
    })
  })

  it('describes an atomically verified saved adjustment as paused', () => {
    const reference = createReference()
    writeTerminalClientDisplayCalibration(
      {
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
        measured: {
          cols: 81,
          rows: 24,
          cssCellWidth: 7.5,
          cssCellHeight: 15,
          effectiveDpr: 2,
        },
        score: 0,
        measuredAt: '2026-04-30T00:00:00.000Z',
      },
      { environmentSignature: 'environment-a', source: 'manual' },
    )

    renderSettingsPanel({
      settings: {
        ...DEFAULT_AGENT_SETTINGS,
        terminalDisplayCalibrationCompensationEnabled: false,
        terminalDisplayReference: reference,
      },
    })
    openAppearanceSettings()

    expect(screen.getByText(/saved adjustment is available but paused/i)).toBeVisible()
  })

  it('does not describe an unverified legacy adjustment as paused', () => {
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
      settings: {
        ...DEFAULT_AGENT_SETTINGS,
        terminalDisplayCalibrationCompensationEnabled: false,
        terminalDisplayReference: reference,
      },
    })
    openAppearanceSettings()

    expect(screen.getByText(/cannot safely match the current target/i)).toBeVisible()
  })
})
