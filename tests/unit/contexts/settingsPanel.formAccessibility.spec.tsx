import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import * as systemFontsHook from '../../../src/app/renderer/shell/hooks/useSystemFonts'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { AgentProviderConfigurePanel } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/AgentProviderConfigurePanel'
import { AppearanceSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/AppearanceSection'
import { CanvasSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/CanvasSection'
import { ExperimentalSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/ExperimentalSection'
import { ExperimentalWorkerWebUiSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/ExperimentalWorkerWebUiSection'
import { GeneralSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/GeneralSection'
import { TaskConfigurationSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/TaskConfigurationSection'
import { TerminalProfileSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/TerminalProfileSection'
import { WorkerSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/WorkerSection'
import { WorkspaceSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/WorkspaceSection'

const noop = (): void => undefined

function expectNamedTestId(testId: string, name: string): void {
  expect(screen.getByTestId(testId)).toHaveAccessibleName(name)
}

function installWorkerApi(mode: 'local' | 'remote'): void {
  const config = {
    version: 1,
    mode,
    remote:
      mode === 'remote'
        ? { hostname: 'worker.example.com', port: 4317, token: 'worker-token' }
        : null,
    webUi: {
      enabled: true,
      port: 4318,
      exposeOnLan: false,
      passwordSet: true,
    },
    updatedAt: null,
  }

  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      meta: { isPackaged: false },
      workerClient: {
        getConfig: vi.fn().mockResolvedValue(config),
        setConfig: vi.fn().mockResolvedValue(config),
        setWebUiSettings: vi.fn().mockResolvedValue(config),
        setWebUiSecurity: vi.fn().mockResolvedValue(config),
        relaunch: vi.fn(),
      },
      worker: {
        getStatus: vi.fn().mockResolvedValue({ status: 'stopped', connection: null }),
        start: vi.fn(),
        stop: vi.fn(),
        getWebUiUrl: vi.fn(),
      },
      cli: {
        getStatus: vi.fn().mockResolvedValue({ installed: false, path: null, healthy: false }),
        install: vi.fn(),
        uninstall: vi.fn(),
      },
      clipboard: { writeText: vi.fn() },
    },
  })
}

describe('Settings form accessible names', () => {
  beforeEach(async () => {
    await applyUiLanguage('en')
    vi.spyOn(systemFontsHook, 'useSystemFonts').mockReturnValue({
      fonts: [],
      isLoading: false,
    })
  })

  afterEach(() => {
    delete (window as { opencoveApi?: unknown }).opencoveApi
    vi.restoreAllMocks()
  })

  it('names General and terminal profile select triggers by their setting context', () => {
    render(
      <>
        <GeneralSection
          language="en"
          updatePolicy="prompt"
          updateChannel="stable"
          updateState={null}
          onChangeLanguage={noop}
          onChangeUpdatePolicy={noop}
          onChangeUpdateChannel={noop}
          onCheckForUpdates={noop}
          onDownloadUpdate={noop}
          onInstallUpdate={noop}
        />
        <TerminalProfileSection
          standardWindowSizeBucket="medium"
          defaultTerminalProfileId={null}
          terminalProfiles={[{ id: 'zsh', label: 'Zsh', runtimeKind: 'posix' }]}
          detectedDefaultTerminalProfileId="zsh"
          onChangeStandardWindowSizeBucket={noop}
          onChangeDefaultTerminalProfileId={noop}
        />
      </>,
    )

    expectNamedTestId('settings-language-trigger', 'Display Language')
    expectNamedTestId('settings-update-policy-trigger', 'Update Behavior')
    expectNamedTestId('settings-update-channel-trigger', 'Release Channel')
    expectNamedTestId('settings-standard-window-size-trigger', 'Standard Window Size')
    expectNamedTestId('settings-terminal-profile-trigger', 'Shell Profile')
  })

  it('names appearance inputs, theme selection, and terminal font controls', () => {
    render(
      <AppearanceSection
        uiTheme="system"
        uiFontSize={16}
        terminalFontSize={14}
        terminalFontFamily={null}
        terminalDisplayAutoReferenceEnabled
        terminalDisplayCalibrationCompensationEnabled
        terminalDisplayReference={null}
        onChangeUiTheme={noop}
        onChangeUiFontSize={noop}
        onChangeTerminalFontSize={noop}
        onChangeTerminalFontFamily={noop}
        onChangeTerminalDisplayAutoReferenceEnabled={noop}
        onChangeTerminalDisplayCalibrationCompensationEnabled={noop}
        onChangeTerminalDisplayReference={noop}
      />,
    )

    expectNamedTestId('settings-ui-theme-trigger', 'Appearance')
    expectNamedTestId('settings-ui-font-size', 'Interface Font Size')
    expectNamedTestId('settings-terminal-font-size', 'Terminal Font Size')
    expectNamedTestId('settings-terminal-font-family', 'Terminal Font')

    fireEvent.click(screen.getByTestId('settings-terminal-font-family'))
    expect(screen.getByRole('textbox', { name: 'Search fonts…' })).toBeVisible()
  })

  it('names canvas select and zoom controls by their setting context', () => {
    render(
      <CanvasSection
        canvasInputMode="trackpad"
        canvasWheelBehavior="pan"
        canvasWheelZoomModifier="primary"
        focusNodeOnClick
        focusNodeTargetZoom={1}
        focusNodeUseVisibleCanvasCenter
        archiveSpaceDeleteWorktreeByDefault={false}
        archiveSpaceDeleteBranchByDefault={false}
        onChangeCanvasInputMode={noop}
        onChangeCanvasWheelBehavior={noop}
        onChangeCanvasWheelZoomModifier={noop}
        onChangeFocusNodeOnClick={noop}
        onChangeFocusNodeTargetZoom={noop}
        onChangeFocusNodeUseVisibleCanvasCenter={noop}
        onChangeArchiveSpaceDeleteWorktreeByDefault={noop}
        onChangeArchiveSpaceDeleteBranchByDefault={noop}
        onFocusNodeTargetZoomPreviewChange={noop}
      />,
    )

    expectNamedTestId('settings-canvas-input-mode-trigger', 'Input Mode')
    expectNamedTestId('settings-canvas-wheel-behavior-trigger', 'Mouse Wheel')
    expectNamedTestId('settings-canvas-wheel-zoom-modifier-trigger', 'Zoom Modifier')
    expectNamedTestId('settings-focus-node-target-zoom', 'Target Zoom')
  })

  it('names task and experimental form controls', () => {
    render(
      <>
        <TaskConfigurationSection
          showTaskTitleGeneration
          defaultProvider="codex"
          taskTitleProvider="default"
          taskTitleModel=""
          effectiveTaskTitleProvider="codex"
          tags={['bug']}
          addTaskTagInput=""
          onChangeTaskTitleProvider={noop}
          onChangeTaskTitleModel={noop}
          onChangeAddTaskTagInput={noop}
          onAddTag={noop}
          onRemoveTag={noop}
        />
        <ExperimentalSection
          websiteWindowPolicy={DEFAULT_AGENT_SETTINGS.websiteWindowPolicy}
          browserDefaultMode={DEFAULT_AGENT_SETTINGS.browserDefaultMode}
          browserSearchEngine={DEFAULT_AGENT_SETTINGS.browserSearchEngine}
          websiteWindowPasteEnabled={DEFAULT_AGENT_SETTINGS.websiteWindowPasteEnabled}
          onChangeWebsiteWindowPolicy={noop}
          onChangeBrowserDefaultMode={noop}
          onChangeBrowserSearchEngine={noop}
          onChangeWebsiteWindowPasteEnabled={noop}
        />
      </>,
    )

    expectNamedTestId('settings-task-title-provider-trigger', 'Title Provider')
    expectNamedTestId('settings-task-title-model', 'Title Model')
    expectNamedTestId('settings-task-tag-add-input', 'Add tag')
    expectNamedTestId('settings-website-window-default-mode-trigger', 'Default Open Mode')
    expectNamedTestId('settings-browser-search-engine-trigger', 'Default Search Engine')
    expectNamedTestId('settings-website-window-max-active', 'Max Active')
    expectNamedTestId('settings-website-window-discard-after', 'Discard After')
    expectNamedTestId(
      'settings-website-keep-alive-add-input',
      'Add host pattern (e.g. *.figma.com)',
    )
  })

  it('names model and dynamic agent environment inputs with provider and row context', () => {
    const settings = {
      ...DEFAULT_AGENT_SETTINGS,
      customModelEnabledByProvider: {
        ...DEFAULT_AGENT_SETTINGS.customModelEnabledByProvider,
        'claude-code': true,
      },
      agentEnvByProvider: {
        ...DEFAULT_AGENT_SETTINGS.agentEnvByProvider,
        'claude-code': [{ id: 'env-1', key: 'ANTHROPIC_API_KEY', value: 'secret', enabled: true }],
      },
    }

    render(
      <AgentProviderConfigurePanel
        provider="claude-code"
        settings={settings}
        modelCatalog={{ models: [], source: null, fetchedAt: null, isLoading: false, error: null }}
        addModelInputValue=""
        onToggleCustomModelEnabled={noop}
        onSelectProviderModel={noop}
        onRemoveCustomModelOption={noop}
        onChangeAddModelInput={noop}
        onAddCustomModelOption={noop}
        onChangeAgentEnvByProvider={noop}
        onDone={noop}
      />,
    )

    expectNamedTestId('settings-custom-model-add-input-claude-code', 'Claude Code Add model...')
    expect(
      screen.getByRole('textbox', { name: 'Claude Code ANTHROPIC_API_KEY variable name' }),
    ).toBeVisible()
    expect(
      screen.getByRole('textbox', { name: 'Claude Code ANTHROPIC_API_KEY variable value' }),
    ).toBeVisible()
  })

  it('names Worker mode, remote connection, and Web UI security controls', async () => {
    installWorkerApi('remote')
    render(
      <>
        <WorkerSection remoteWorkersEnabled />
        <ExperimentalWorkerWebUiSection />
      </>,
    )

    expectNamedTestId('settings-worker-home-mode-trigger', 'Worker Mode')
    expectNamedTestId('settings-experimental-worker-web-ui-port', 'Port')
    expectNamedTestId('settings-experimental-worker-web-ui-password', 'Password')
    expect(await screen.findByTestId('settings-worker-remote-hostname')).toHaveAccessibleName(
      'Hostname',
    )
    expectNamedTestId('settings-worker-remote-port', 'Port')
    expectNamedTestId('settings-worker-remote-token', 'Token')
  })

  it('names project worktree and environment variable inputs', () => {
    render(
      <WorkspaceSection
        workspaceName="Cove"
        workspacePath="/repo/cove"
        worktreesRoot=".opencove/worktrees"
        onChangeWorktreesRoot={noop}
        environmentVariables={{}}
        onChangeEnvironmentVariables={noop}
      />,
    )

    expectNamedTestId('settings-worktree-root', 'Worktree Root')
    expectNamedTestId('settings-env-var-key-input', 'Environment variable name')
    expectNamedTestId('settings-env-var-value-input', 'Environment variable value')
  })

  it('keeps newly introduced environment input names localized in Chinese', async () => {
    await applyUiLanguage('zh-CN')

    render(
      <WorkspaceSection
        workspaceName="Cove"
        workspacePath="/repo/cove"
        worktreesRoot=".opencove/worktrees"
        onChangeWorktreesRoot={noop}
        environmentVariables={{}}
        onChangeEnvironmentVariables={noop}
      />,
    )

    expectNamedTestId('settings-worktree-root', 'Worktree 根目录')
    expectNamedTestId('settings-env-var-key-input', '环境变量名')
    expectNamedTestId('settings-env-var-value-input', '环境变量值')
  })
})
