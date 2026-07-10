import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
} from '../../../src/contexts/settings/domain/agentSettings'
import type { AppUpdateState } from '../../../src/shared/contracts/dto'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'
import { installSettingsPanelWorkerApi } from './settingsPanelWorkerApiTestUtils'

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

function createUpdateState(overrides: Partial<AppUpdateState> = {}): AppUpdateState {
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
    ...overrides,
  }
}

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
      {...overrides}
    />,
  )
}

describe('SettingsPanel', () => {
  afterEach(() => {
    delete (window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi
  })

  it('persists the selected default profile', () => {
    const onChange = vi.fn()
    mockTerminalProfiles({
      terminalProfiles: [
        { id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' },
        { id: 'wsl:Ubuntu', label: 'WSL (Ubuntu)', runtimeKind: 'wsl' },
      ],
      detectedDefaultTerminalProfileId: 'powershell',
    })
    renderSettingsPanel({ onChange })

    const canvasNav = screen.getByTestId('settings-section-nav-canvas')
    fireEvent.click(canvasNav)

    const trigger = screen.getByTestId('settings-terminal-profile-trigger')
    expect(trigger).toBeVisible()
    expect(screen.getByText('Automatic (PowerShell)')).toBeVisible()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: 'WSL (Ubuntu)' }))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      defaultTerminalProfileId: 'wsl:Ubuntu',
    })
  })

  it('exposes terminal display consistency controls in display settings', () => {
    mockTerminalProfiles()
    renderSettingsPanel()

    fireEvent.click(screen.getByTestId('settings-section-nav-appearance'))

    expect(screen.getByText('Terminal Display Consistency')).toBeVisible()
    expect(screen.getByText('Set Reference Automatically')).toBeVisible()
    expect(screen.getByText('Apply Calibration Automatically')).toBeVisible()
    expect(
      (screen.getByTestId('settings-terminal-display-auto-reference') as HTMLInputElement).checked,
    ).toBe(true)
    expect(
      (screen.getByTestId('settings-terminal-display-compensation') as HTMLInputElement).checked,
    ).toBe(true)
    expect(screen.getByTestId('settings-terminal-display-set-reference')).toBeVisible()
    expect(screen.getByTestId('settings-terminal-display-calibrate')).toBeDisabled()
  })

  it('allows reordering agent providers', () => {
    const onChange = vi.fn()
    mockTerminalProfiles()
    renderSettingsPanel({ onChange })

    fireEvent.click(screen.getByTestId('settings-section-nav-agent'))
    fireEvent.click(screen.getByTestId('settings-agent-order-move-down-claude-code'))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      agentProviderOrder: ['codex', 'claude-code', 'opencode', 'gemini'],
    })
  })

  it('sets the default agent from the agent list', () => {
    const onChange = vi.fn()
    mockTerminalProfiles()
    renderSettingsPanel({ onChange })

    fireEvent.click(screen.getByTestId('settings-section-nav-agent'))
    fireEvent.click(screen.getByTestId('settings-default-provider-gemini'))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      defaultProvider: 'gemini',
    })
  })

  it('checks agent executable availability without exposing manual path input', async () => {
    const listInstalledProviders = vi.fn(async () => ({
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
          executablePath: '/usr/local/bin/codex',
          source: 'process_path' as const,
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
    }))

    ;(window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi = {
      agent: {
        listInstalledProviders,
      },
    } as Window['opencoveApi']

    mockTerminalProfiles()
    renderSettingsPanel()

    fireEvent.click(screen.getByTestId('settings-section-nav-agent'))

    await waitFor(() => {
      expect(listInstalledProviders).toHaveBeenCalledWith({
        executablePathOverrideByProvider:
          DEFAULT_AGENT_SETTINGS.agentExecutablePathOverrideByProvider,
      })
    })

    expect(screen.queryByTestId('settings-agent-executable-override-codex')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-agent-executable-install-codex')).toHaveTextContent(
      'Installed',
    )
  })

  it('updates the standard window size bucket from canvas settings', () => {
    const onChange = vi.fn()
    mockTerminalProfiles()
    renderSettingsPanel({ onChange })

    fireEvent.click(screen.getByTestId('settings-section-nav-canvas'))
    fireEvent.click(screen.getByTestId('settings-standard-window-size-trigger'))
    fireEvent.click(screen.getByRole('option', { name: 'Large' }))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      standardWindowSizeBucket: 'large',
    })
  })

  it('toggles visible-canvas centering from canvas settings', () => {
    const onChange = vi.fn()
    mockTerminalProfiles()
    renderSettingsPanel({ onChange })

    fireEvent.click(screen.getByTestId('settings-section-nav-canvas'))
    fireEvent.click(screen.getByTestId('settings-focus-node-visible-center'))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      focusNodeUseVisibleCanvasCenter: false,
    })
  })

  it('toggles archive Space default actions from canvas settings', () => {
    const onChange = vi.fn()
    mockTerminalProfiles()
    renderSettingsPanel({ onChange })

    fireEvent.click(screen.getByTestId('settings-section-nav-canvas'))
    fireEvent.click(
      screen
        .getByTestId('settings-archive-space-delete-worktree-default')
        .querySelector('input') as HTMLInputElement,
    )
    fireEvent.click(
      screen
        .getByTestId('settings-archive-space-delete-branch-default')
        .querySelector('input') as HTMLInputElement,
    )

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      archiveSpaceDeleteWorktreeByDefault: false,
    })
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      archiveSpaceDeleteBranchByDefault: true,
    })
  })

  it('updates release channel settings and exposes update actions', () => {
    const onChange = vi.fn()
    const onCheckForUpdates = vi.fn()
    const onDownloadUpdate = vi.fn()
    mockTerminalProfiles()
    renderSettingsPanel({
      updateState: createUpdateState({
        status: 'available',
        latestVersion: '0.2.1',
        checkedAt: '2026-03-20T00:00:00.000Z',
      }),
      onChange,
      onCheckForUpdates,
      onDownloadUpdate,
    })

    fireEvent.click(screen.getByTestId('settings-update-policy-trigger'))
    fireEvent.click(screen.getByRole('option', { name: 'Auto Update' }))
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      updatePolicy: 'auto',
    })

    fireEvent.click(screen.getByTestId('settings-update-channel-trigger'))
    fireEvent.click(screen.getByRole('option', { name: 'Nightly' }))
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      updateChannel: 'nightly',
      updatePolicy: 'prompt',
    })

    fireEvent.click(screen.getByTestId('settings-update-check'))
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('settings-update-download'))
    expect(onDownloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('toggles remote workers from Worker & Connections settings', () => {
    const onChange = vi.fn()
    mockTerminalProfiles()
    installSettingsPanelWorkerApi()
    renderSettingsPanel({ onChange })

    fireEvent.click(screen.getByTestId('settings-section-nav-worker'))
    fireEvent.click(screen.getByTestId('settings-experimental-remote-workers-enabled'))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      experimentalRemoteWorkersEnabled: true,
    })
  })

  it('keeps endpoints inside Worker settings and gates registration until enabled', () => {
    mockTerminalProfiles()
    installSettingsPanelWorkerApi()
    const { rerender } = renderSettingsPanel()

    fireEvent.click(screen.getByTestId('settings-section-nav-worker'))
    expect(screen.getByText('Remote Workers disabled')).toBeVisible()
    expect(screen.queryByTestId('settings-endpoints-empty-register')).not.toBeInTheDocument()

    rerender(
      <SettingsPanel
        settings={{ ...DEFAULT_AGENT_SETTINGS, experimentalRemoteWorkersEnabled: true }}
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

    expect(screen.getByTestId('settings-endpoints-empty-register')).toBeVisible()
  })

  it('toggles the opt-in header performance monitor button from diagnostics settings', () => {
    const onChange = vi.fn()
    ;(window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi = {
      performanceDiagnostics: {
        getSnapshot: vi.fn(async () => ({
          capturedAt: '2026-05-07T00:00:00.000Z',
          platform: 'win32',
          arch: 'x64',
          mainPid: 100,
          processTree: {
            status: 'available' as const,
            rootPid: 100,
            sampledProcessCount: 0,
            message: null,
          },
          processes: [],
          processSummary: [],
          electronMetrics: [],
          notes: [],
        })),
      },
    } as Window['opencoveApi']

    mockTerminalProfiles()
    renderSettingsPanel({ onChange })

    fireEvent.click(screen.getByTestId('settings-section-nav-experimental'))

    const toggle = screen.getByTestId(
      'settings-performance-monitor-header-button-enabled',
    ) as HTMLInputElement
    expect(toggle.checked).toBe(false)

    fireEvent.click(toggle)

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      performanceMonitorHeaderButtonEnabled: true,
    })
  })

  it('loads and copies performance diagnostics from settings', async () => {
    const getSnapshot = vi.fn(async () => ({
      capturedAt: '2026-05-07T00:00:00.000Z',
      platform: 'win32',
      arch: 'x64',
      mainPid: 100,
      processTree: {
        status: 'available' as const,
        rootPid: 100,
        sampledProcessCount: 2,
        message: null,
      },
      processes: [],
      processSummary: [
        {
          kind: 'opencove-renderer' as const,
          scope: 'opencove' as const,
          count: 1,
          workingSetBytes: 24 * 1024 * 1024,
          privateBytes: 20 * 1024 * 1024,
          threadCount: 12,
        },
        {
          kind: 'external-agent-codex' as const,
          scope: 'external-agent' as const,
          count: 1,
          workingSetBytes: 12 * 1024 * 1024,
          privateBytes: 10 * 1024 * 1024,
          threadCount: 4,
        },
      ],
      electronMetrics: [],
      notes: ['collector excluded'],
    }))
    const writeText = vi.fn(async () => undefined)

    ;(window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi = {
      performanceDiagnostics: {
        getSnapshot,
      },
      clipboard: {
        readText: vi.fn(async () => ''),
        writeText,
      },
    } as Window['opencoveApi']

    mockTerminalProfiles()
    renderSettingsPanel()

    fireEvent.click(screen.getByTestId('settings-section-nav-experimental'))

    expect(await screen.findByText('Performance Diagnostics')).toBeVisible()
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1))
    expect(screen.getByText('OpenCove renderer')).toBeVisible()
    expect(screen.getByText('Codex CLI')).toBeVisible()
    expect(screen.getByText('12.0 MB')).toBeVisible()
    expect(screen.getByText('Threads')).toBeVisible()
    expect(screen.queryByText('Reserved memory')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('settings-diagnostics-copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0]).toContain('external-agent-codex')
  })
})
