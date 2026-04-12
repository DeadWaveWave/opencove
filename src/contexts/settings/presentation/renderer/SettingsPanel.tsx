import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { useTerminalProfiles } from '@app/renderer/shell/hooks/useTerminalProfiles'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import {
  AGENT_PROVIDERS,
  resolveTaskTitleProvider,
  type AgentProvider,
  type AgentSettings,
  type CanvasInputMode,
  type CanvasWheelBehavior,
  type CanvasWheelZoomModifier,
  type FocusNodeTargetZoom,
  type StandardWindowSizeBucket,
  type TaskTitleProvider,
  type UiLanguage,
  type UiTheme,
} from '@contexts/settings/domain/agentSettings'
import { AgentSection } from './settingsPanel/AgentSection'
import { CanvasSection } from './settingsPanel/CanvasSection'
import { ExperimentalSection } from './settingsPanel/ExperimentalSection'
import { GeneralSection } from './settingsPanel/GeneralSection'
import { IntegrationsSection } from './settingsPanel/IntegrationsSection'
import { ModelOverrideSection } from './settingsPanel/ModelOverrideSection'
import { NotificationsSection } from './settingsPanel/NotificationsSection'
import { SettingsPanelNavButton } from './settingsPanel/SettingsPanelNavButton'
import { ShortcutsSection } from './settingsPanel/ShortcutsSection'
import { TaskConfigurationSection } from './settingsPanel/TaskConfigurationSection'
import { WorkerSection } from './settingsPanel/WorkerSection'
import { WorkspaceSection } from './settingsPanel/WorkspaceSection'
import {
  createInitialInputState,
  getFolderName,
  getWorkspacePageId,
  isWorkspacePageId,
  type SettingsPageId,
  type SettingsPanelProps,
} from './SettingsPanel.shared'

export function SettingsPanel({
  settings,
  updateState,
  modelCatalogByProvider,
  workspaces,
  onWorkspaceWorktreesRootChange,
  isFocusNodeTargetZoomPreviewing,
  onFocusNodeTargetZoomPreviewChange,
  onChange,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onClose,
}: SettingsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { terminalProfiles, detectedDefaultTerminalProfileId } = useTerminalProfiles()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [addModelInputByProvider, setAddModelInputByProvider] = useState<
    Record<AgentProvider, string>
  >(() => createInitialInputState(AGENT_PROVIDERS))
  const [activePageId, setActivePageId] = useState<SettingsPageId>('general')
  const [addTaskTagInput, setAddTaskTagInput] = useState('')

  const updateDefaultProvider = (provider: AgentProvider): void =>
    onChange({ ...settings, defaultProvider: provider })
  const updateAgentProviderOrder = (providers: AgentProvider[]): void =>
    onChange({ ...settings, agentProviderOrder: providers })
  const updateLanguage = (language: UiLanguage): void => onChange({ ...settings, language })
  const updateUiTheme = (uiTheme: UiTheme): void => onChange({ ...settings, uiTheme })
  const updateAgentFullAccess = (enabled: boolean): void =>
    onChange({ ...settings, agentFullAccess: enabled })
  const updateDefaultTerminalProfileId = (profileId: string | null): void =>
    onChange({ ...settings, defaultTerminalProfileId: profileId })
  const updateTaskTitleProvider = (provider: TaskTitleProvider): void =>
    onChange({ ...settings, taskTitleProvider: provider })
  const updateTaskTitleModel = (model: string): void =>
    onChange({ ...settings, taskTitleModel: model })
  const updateFocusNodeOnClick = (enabled: boolean): void =>
    onChange({ ...settings, focusNodeOnClick: enabled })
  const updateFocusNodeTargetZoom = (zoom: FocusNodeTargetZoom): void =>
    onChange({ ...settings, focusNodeTargetZoom: zoom })
  const updateFocusNodeUseVisibleCanvasCenter = (enabled: boolean): void =>
    onChange({ ...settings, focusNodeUseVisibleCanvasCenter: enabled })
  const updateStandbyBannerEnabled = (enabled: boolean): void =>
    onChange({ ...settings, standbyBannerEnabled: enabled })
  const updateStandbyBannerShowTask = (enabled: boolean): void =>
    onChange({ ...settings, standbyBannerShowTask: enabled })
  const updateStandbyBannerShowSpace = (enabled: boolean): void =>
    onChange({ ...settings, standbyBannerShowSpace: enabled })
  const updateStandbyBannerShowBranch = (enabled: boolean): void =>
    onChange({ ...settings, standbyBannerShowBranch: enabled })
  const updateStandbyBannerShowPullRequest = (enabled: boolean): void =>
    onChange({ ...settings, standbyBannerShowPullRequest: enabled })
  const updateCanvasInputMode = (mode: CanvasInputMode): void =>
    onChange({ ...settings, canvasInputMode: mode })
  const updateCanvasWheelBehavior = (behavior: CanvasWheelBehavior): void =>
    onChange({ ...settings, canvasWheelBehavior: behavior })
  const updateCanvasWheelZoomModifier = (modifier: CanvasWheelZoomModifier): void =>
    onChange({ ...settings, canvasWheelZoomModifier: modifier })
  const updateStandardWindowSizeBucket = (bucket: StandardWindowSizeBucket): void =>
    onChange({ ...settings, standardWindowSizeBucket: bucket })
  const updateWebsiteWindowPolicy = (policy: AgentSettings['websiteWindowPolicy']): void =>
    onChange({ ...settings, websiteWindowPolicy: policy })
  const updateExperimentalWebsiteWindowPasteEnabled = (enabled: boolean): void =>
    onChange({ ...settings, experimentalWebsiteWindowPasteEnabled: enabled })
  const updateTerminalFontSize = (fontSize: number): void =>
    onChange({ ...settings, terminalFontSize: Math.round(fontSize) })
  const updateTerminalFontFamily = (family: string | null): void =>
    onChange({ ...settings, terminalFontFamily: family })
  const updateUiFontSize = (fontSize: number): void =>
    onChange({ ...settings, uiFontSize: fontSize })
  const updateUpdatePolicy = (policy: AgentSettings['updatePolicy']): void => {
    const normalized = settings.updateChannel === 'nightly' && policy === 'auto' ? 'prompt' : policy
    onChange({ ...settings, updatePolicy: normalized })
  }

  const updateUpdateChannel = (channel: AgentSettings['updateChannel']): void => {
    const normalizedPolicy =
      channel === 'nightly' && settings.updatePolicy === 'auto' ? 'prompt' : settings.updatePolicy
    onChange({ ...settings, updateChannel: channel, updatePolicy: normalizedPolicy })
  }
  const updateTaskTagOptions = (nextTags: string[]): void =>
    onChange({ ...settings, taskTagOptions: nextTags })
  const updateDisableAppShortcutsWhenTerminalFocused = (enabled: boolean): void =>
    onChange({ ...settings, disableAppShortcutsWhenTerminalFocused: enabled })
  const updateKeybindings = (keybindings: AgentSettings['keybindings']): void =>
    onChange({ ...settings, keybindings })
  const updateGitHubPullRequestsEnabled = (enabled: boolean): void =>
    onChange({ ...settings, githubPullRequestsEnabled: enabled })

  const removeTaskTagOption = (tag: string): void => {
    const nextTags = settings.taskTagOptions.filter(option => option !== tag)
    if (nextTags.length > 0) {
      updateTaskTagOptions(nextTags)
    }
  }

  const addTaskTagOption = (): void => {
    const candidate = addTaskTagInput.trim()
    if (candidate.length === 0) {
      return
    }

    const nextTags = settings.taskTagOptions.includes(candidate)
      ? settings.taskTagOptions
      : [...settings.taskTagOptions, candidate]
    updateTaskTagOptions(nextTags)
    setAddTaskTagInput('')
  }

  const updateProviderCustomModelEnabled = (provider: AgentProvider, enabled: boolean): void => {
    onChange({
      ...settings,
      customModelEnabledByProvider: {
        ...settings.customModelEnabledByProvider,
        [provider]: enabled,
      },
    })
  }

  const selectProviderModel = (provider: AgentProvider, model: string): void => {
    onChange({
      ...settings,
      customModelEnabledByProvider: { ...settings.customModelEnabledByProvider, [provider]: true },
      customModelByProvider: { ...settings.customModelByProvider, [provider]: model },
    })
  }

  const removeCustomModelOption = (provider: AgentProvider, model: string): void => {
    const currentOptions = settings.customModelOptionsByProvider[provider]
    if (!currentOptions.includes(model)) {
      return
    }

    const nextOptions = currentOptions.filter(option => option !== model)
    onChange({
      ...settings,
      customModelByProvider: {
        ...settings.customModelByProvider,
        [provider]:
          settings.customModelByProvider[provider] === model
            ? ''
            : settings.customModelByProvider[provider],
      },
      customModelOptionsByProvider: {
        ...settings.customModelOptionsByProvider,
        [provider]: nextOptions,
      },
    })
  }

  const updateAddModelInput = (provider: AgentProvider, value: string): void =>
    setAddModelInputByProvider(prev => ({ ...prev, [provider]: value }))

  const addCustomModelOption = (provider: AgentProvider): void => {
    const candidate = addModelInputByProvider[provider].trim()
    if (candidate.length === 0) {
      return
    }

    const existingOptions = settings.customModelOptionsByProvider[provider]
    const nextOptions = existingOptions.includes(candidate)
      ? existingOptions
      : [...existingOptions, candidate]
    onChange({
      ...settings,
      customModelEnabledByProvider: { ...settings.customModelEnabledByProvider, [provider]: true },
      customModelByProvider: { ...settings.customModelByProvider, [provider]: candidate },
      customModelOptionsByProvider: {
        ...settings.customModelOptionsByProvider,
        [provider]: nextOptions,
      },
    })
    setAddModelInputByProvider(prev => ({ ...prev, [provider]: '' }))
  }

  const effectiveTaskTitleProvider = useMemo(() => resolveTaskTitleProvider(settings), [settings])

  const activeWorkspace = useMemo(() => {
    if (!isWorkspacePageId(activePageId)) {
      return null
    }

    const workspaceId = activePageId.slice('workspace:'.length)
    return workspaces.find(workspace => workspace.id === workspaceId) ?? null
  }, [activePageId, workspaces])

  useEffect(() => {
    if (isWorkspacePageId(activePageId) && !activeWorkspace) {
      setActivePageId('general')
    }
  }, [activePageId, activeWorkspace])

  useEffect(() => {
    if (!contentRef.current) {
      return
    }

    contentRef.current.scrollTop = 0
  }, [activePageId])

  useEffect(() => {
    if (activePageId !== 'canvas') {
      onFocusNodeTargetZoomPreviewChange(false)
    }
  }, [activePageId, onFocusNodeTargetZoomPreviewChange])

  return (
    <div
      className={`settings-backdrop${isFocusNodeTargetZoomPreviewing ? ' settings-backdrop--preview' : ''}`}
      onClick={onClose}
    >
      <section
        className={`settings-panel${isFocusNodeTargetZoomPreviewing ? ' settings-panel--preview' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <aside
          className="settings-panel__sidebar"
          aria-label={t('settingsPanel.nav.sectionsLabel')}
        >
          <SettingsPanelNavButton
            isActive={activePageId === 'general'}
            label={t('settingsPanel.nav.general')}
            testId="settings-section-nav-general"
            onClick={() => setActivePageId('general')}
          />
          <SettingsPanelNavButton
            isActive={activePageId === 'worker'}
            label={t('settingsPanel.nav.worker')}
            testId="settings-section-nav-worker"
            onClick={() => setActivePageId('worker')}
          />
          <SettingsPanelNavButton
            isActive={activePageId === 'agent'}
            label={t('settingsPanel.nav.agent')}
            testId="settings-section-nav-agent"
            onClick={() => setActivePageId('agent')}
          />
          <SettingsPanelNavButton
            isActive={activePageId === 'notifications'}
            label={t('settingsPanel.nav.notifications')}
            testId="settings-section-nav-notifications"
            onClick={() => setActivePageId('notifications')}
          />
          <SettingsPanelNavButton
            isActive={activePageId === 'canvas'}
            label={t('settingsPanel.nav.canvas')}
            testId="settings-section-nav-canvas"
            onClick={() => setActivePageId('canvas')}
          />
          <SettingsPanelNavButton
            isActive={activePageId === 'shortcuts'}
            label={t('settingsPanel.nav.shortcuts')}
            testId="settings-section-nav-shortcuts"
            onClick={() => setActivePageId('shortcuts')}
          />
          <SettingsPanelNavButton
            isActive={activePageId === 'task-configuration'}
            label={t('settingsPanel.nav.tasks')}
            testId="settings-section-nav-task-configuration"
            onClick={() => setActivePageId('task-configuration')}
          />
          <SettingsPanelNavButton
            isActive={activePageId === 'integrations'}
            label={t('settingsPanel.nav.integrations')}
            testId="settings-section-nav-integrations"
            onClick={() => setActivePageId('integrations')}
          />
          <SettingsPanelNavButton
            isActive={activePageId === 'experimental'}
            label={t('settingsPanel.nav.experimental')}
            testId="settings-section-nav-experimental"
            onClick={() => setActivePageId('experimental')}
          />

          <div className="settings-panel__nav-group-label">{t('settingsPanel.nav.projects')}</div>
          <div className="settings-panel__nav-group">
            {workspaces.map(workspace => (
              <SettingsPanelNavButton
                key={workspace.id}
                isActive={activePageId === getWorkspacePageId(workspace.id)}
                label={
                  workspace.name.trim().length > 0 ? workspace.name : getFolderName(workspace.path)
                }
                onClick={() => setActivePageId(getWorkspacePageId(workspace.id))}
              />
            ))}
          </div>
        </aside>

        <div className="settings-panel__content-wrapper">
          <div className="settings-panel__header">
            <h2>{t('settingsPanel.title')}</h2>
            <button type="button" className="settings-panel__close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="settings-panel__content" ref={contentRef}>
            {activePageId === 'general' ? (
              <GeneralSection
                language={settings.language}
                uiTheme={settings.uiTheme}
                uiFontSize={settings.uiFontSize}
                terminalFontSize={settings.terminalFontSize}
                terminalFontFamily={settings.terminalFontFamily}
                updatePolicy={settings.updatePolicy}
                updateChannel={settings.updateChannel}
                updateState={updateState}
                onChangeLanguage={updateLanguage}
                onChangeUiTheme={updateUiTheme}
                onChangeUiFontSize={updateUiFontSize}
                onChangeTerminalFontSize={updateTerminalFontSize}
                onChangeTerminalFontFamily={updateTerminalFontFamily}
                onChangeUpdatePolicy={updateUpdatePolicy}
                onChangeUpdateChannel={updateUpdateChannel}
                onCheckForUpdates={onCheckForUpdates}
                onDownloadUpdate={onDownloadUpdate}
                onInstallUpdate={onInstallUpdate}
              />
            ) : null}

            {activePageId === 'worker' ? <WorkerSection /> : null}

            {activePageId === 'agent' ? (
              <>
                <AgentSection
                  defaultProvider={settings.defaultProvider}
                  agentProviderOrder={settings.agentProviderOrder}
                  agentFullAccess={settings.agentFullAccess}
                  onChangeDefaultProvider={updateDefaultProvider}
                  onChangeAgentProviderOrder={updateAgentProviderOrder}
                  onChangeAgentFullAccess={updateAgentFullAccess}
                />
                <ModelOverrideSection
                  settings={settings}
                  modelCatalogByProvider={modelCatalogByProvider}
                  addModelInputByProvider={addModelInputByProvider}
                  onToggleCustomModelEnabled={updateProviderCustomModelEnabled}
                  onSelectProviderModel={selectProviderModel}
                  onRemoveCustomModelOption={removeCustomModelOption}
                  onChangeAddModelInput={updateAddModelInput}
                  onAddCustomModelOption={addCustomModelOption}
                />
              </>
            ) : null}

            {activePageId === 'notifications' ? (
              <NotificationsSection
                standbyBannerEnabled={settings.standbyBannerEnabled}
                standbyBannerShowTask={settings.standbyBannerShowTask}
                standbyBannerShowSpace={settings.standbyBannerShowSpace}
                standbyBannerShowBranch={settings.standbyBannerShowBranch}
                standbyBannerShowPullRequest={settings.standbyBannerShowPullRequest}
                githubPullRequestsEnabled={settings.githubPullRequestsEnabled}
                onChangeStandbyBannerEnabled={updateStandbyBannerEnabled}
                onChangeStandbyBannerShowTask={updateStandbyBannerShowTask}
                onChangeStandbyBannerShowSpace={updateStandbyBannerShowSpace}
                onChangeStandbyBannerShowBranch={updateStandbyBannerShowBranch}
                onChangeStandbyBannerShowPullRequest={updateStandbyBannerShowPullRequest}
              />
            ) : null}

            {activePageId === 'integrations' ? (
              <IntegrationsSection
                githubPullRequestsEnabled={settings.githubPullRequestsEnabled}
                onChangeGitHubPullRequestsEnabled={updateGitHubPullRequestsEnabled}
              />
            ) : null}

            {activePageId === 'canvas' ? (
              <CanvasSection
                canvasInputMode={settings.canvasInputMode}
                canvasWheelBehavior={settings.canvasWheelBehavior}
                canvasWheelZoomModifier={settings.canvasWheelZoomModifier}
                standardWindowSizeBucket={settings.standardWindowSizeBucket}
                focusNodeOnClick={settings.focusNodeOnClick}
                focusNodeTargetZoom={settings.focusNodeTargetZoom}
                focusNodeUseVisibleCanvasCenter={settings.focusNodeUseVisibleCanvasCenter}
                defaultTerminalProfileId={settings.defaultTerminalProfileId}
                terminalProfiles={terminalProfiles}
                detectedDefaultTerminalProfileId={detectedDefaultTerminalProfileId}
                onChangeCanvasInputMode={updateCanvasInputMode}
                onChangeCanvasWheelBehavior={updateCanvasWheelBehavior}
                onChangeCanvasWheelZoomModifier={updateCanvasWheelZoomModifier}
                onChangeStandardWindowSizeBucket={updateStandardWindowSizeBucket}
                onChangeDefaultTerminalProfileId={updateDefaultTerminalProfileId}
                onChangeFocusNodeOnClick={updateFocusNodeOnClick}
                onChangeFocusNodeTargetZoom={updateFocusNodeTargetZoom}
                onChangeFocusNodeUseVisibleCanvasCenter={updateFocusNodeUseVisibleCanvasCenter}
                onFocusNodeTargetZoomPreviewChange={onFocusNodeTargetZoomPreviewChange}
              />
            ) : null}

            {activePageId === 'experimental' ? (
              <ExperimentalSection
                websiteWindowPolicy={settings.websiteWindowPolicy}
                websiteWindowPasteEnabled={settings.experimentalWebsiteWindowPasteEnabled}
                onChangeWebsiteWindowPolicy={updateWebsiteWindowPolicy}
                onChangeWebsiteWindowPasteEnabled={updateExperimentalWebsiteWindowPasteEnabled}
              />
            ) : null}

            {activePageId === 'shortcuts' ? (
              <ShortcutsSection
                disableAppShortcutsWhenTerminalFocused={
                  settings.disableAppShortcutsWhenTerminalFocused
                }
                keybindings={settings.keybindings}
                onChangeDisableAppShortcutsWhenTerminalFocused={
                  updateDisableAppShortcutsWhenTerminalFocused
                }
                onChangeKeybindings={updateKeybindings}
              />
            ) : null}

            {activePageId === 'task-configuration' ? (
              <TaskConfigurationSection
                showTaskTitleGeneration={AI_NAMING_FEATURES.taskTitleGeneration}
                defaultProvider={settings.defaultProvider}
                taskTitleProvider={settings.taskTitleProvider}
                taskTitleModel={settings.taskTitleModel}
                effectiveTaskTitleProvider={effectiveTaskTitleProvider}
                tags={settings.taskTagOptions}
                addTaskTagInput={addTaskTagInput}
                onChangeTaskTitleProvider={updateTaskTitleProvider}
                onChangeTaskTitleModel={updateTaskTitleModel}
                onChangeAddTaskTagInput={setAddTaskTagInput}
                onAddTag={addTaskTagOption}
                onRemoveTag={removeTaskTagOption}
              />
            ) : null}

            {isWorkspacePageId(activePageId) && activeWorkspace ? (
              <WorkspaceSection
                sectionId={`settings-section-workspace-${activeWorkspace.id}`}
                workspaceName={activeWorkspace.name}
                workspacePath={activeWorkspace.path}
                worktreesRoot={activeWorkspace.worktreesRoot}
                onChangeWorktreesRoot={root =>
                  onWorkspaceWorktreesRootChange(activeWorkspace.id, root)
                }
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
