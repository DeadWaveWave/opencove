import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { useTerminalProfiles } from '@app/renderer/shell/hooks/useTerminalProfiles'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import {
  AGENT_PROVIDERS,
  resolveTaskTitleProvider,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'
import { AdvancedSection } from './settingsPanel/AdvancedSection'
import { CanvasWindowsSection } from './settingsPanel/CanvasWindowsSection'
import { GeneralSection } from './settingsPanel/GeneralSection'
import { AppearanceSection } from './settingsPanel/AppearanceSection'
import { IntegrationsSection } from './settingsPanel/IntegrationsSection'
import { NotificationsSection } from './settingsPanel/NotificationsSection'
import { SettingsPanelHeader } from './settingsPanel/SettingsPanelHeader'
import { SettingsPanelSidebar } from './settingsPanel/SettingsPanelSidebar'
import { TasksAndShortcutsSection } from './settingsPanel/TasksAndShortcutsSection'
import { AgentSettingsPage } from './settingsPanel/AgentSettingsPage'
import { WorkerConnectionsSection } from './settingsPanel/WorkerConnectionsSection'
import { WorkspaceSection } from './settingsPanel/WorkspaceSection'
import type { SettingsSearchResult } from './settingsPanel/settingsSearchIndex'
import {
  createInitialInputState,
  getFolderName,
  isWorkspacePageId,
  type SettingsPanelProps,
} from './SettingsPanel.shared'
import { useSettingsPanelPageState } from './useSettingsPanelPageState'
import { createSettingsPanelUpdaters } from './useSettingsPanelUpdaters'
import { useSettingsPanelDialog } from './useSettingsPanelDialog'
import { resolveSettingsPage } from './settingsPanel/settingsPageRegistry'

export function SettingsPanel({
  initialPageId,
  settings,
  openPageId,
  updateState,
  modelCatalogByProvider,
  workspaces,
  onWorkspaceWorktreesRootChange,
  onWorkspaceEnvironmentVariablesChange,
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
  const panelRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const highlightedSearchTargetRef = useRef<HTMLElement | null>(null)
  const searchHighlightTimeoutRef = useRef<number | null>(null)
  const [addModelInputByProvider, setAddModelInputByProvider] = useState<
    Record<AgentProvider, string>
  >(() => createInitialInputState(AGENT_PROVIDERS))
  const [addTaskTagInput, setAddTaskTagInput] = useState('')
  const { activePageId, canonicalPageId, setActivePageId, activeWorkspace } =
    useSettingsPanelPageState({
      openPageId,
      workspaces,
      contentRef,
      onFocusNodeTargetZoomPreviewChange,
    })
  const resolvedActivePage = useMemo(() => resolveSettingsPage(activePageId), [activePageId])

  useSettingsPanelDialog(panelRef)

  useEffect(() => {
    if (initialPageId) {
      setActivePageId(initialPageId)
    }
  }, [initialPageId, setActivePageId])

  const {
    updateDefaultProvider,
    updateAgentProviderOrder,
    updateLanguage,
    updateUiTheme,
    updateAgentFullAccess,
    updateDefaultTerminalProfileId,
    updateTaskTitleProvider,
    updateTaskTitleModel,
    updateFocusNodeOnClick,
    updateFocusNodeTargetZoom,
    updateFocusNodeUseVisibleCanvasCenter,
    updateArchiveSpaceDeleteWorktreeByDefault,
    updateArchiveSpaceDeleteBranchByDefault,
    updateSystemNotificationsEnabled,
    updateStandbyBannerEnabled,
    updateStandbyBannerShowTask,
    updateStandbyBannerShowSpace,
    updateStandbyBannerShowBranch,
    updateStandbyBannerShowPullRequest,
    updateCanvasInputMode,
    updateCanvasWheelBehavior,
    updateCanvasWheelZoomModifier,
    updateStandardWindowSizeBucket,
    updateWebsiteWindowPolicy,
    updateBrowserDefaultMode,
    updateBrowserSearchEngine,
    updateExperimentalWebsiteWindowPasteEnabled,
    updateExperimentalRemoteWorkersEnabled,
    updateTerminalFontSize,
    updateTerminalFontFamily,
    updateTerminalAutoReference,
    updateTerminalCompensation,
    updateTerminalDisplayReference,
    updateUiFontSize,
    updateUpdatePolicy,
    updateUpdateChannel,
    updateTaskTagOptions,
    updateQuickCommands,
    updateQuickPhrases,
    updateAgentEnvByProvider,
    updateDisableAppShortcutsWhenTerminalFocused,
    updateKeybindings,
    updateGitHubPullRequestsEnabled,
    updatePerformanceMonitorHeaderButtonEnabled,
  } = createSettingsPanelUpdaters({ settings, onChange })

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

  useEffect(() => {
    if (activePageId !== 'endpoints') {
      return
    }

    if (settings.experimentalRemoteWorkersEnabled) {
      return
    }

    setActivePageId('worker')
  }, [activePageId, setActivePageId, settings.experimentalRemoteWorkersEnabled])

  const selectSearchResult = (result: SettingsSearchResult): void => {
    setActivePageId(result.pageId)

    window.requestAnimationFrame(() => {
      const target = document.getElementById(result.anchorId)
      if (!target) {
        contentRef.current?.scrollTo({ top: 0 })
        return
      }

      target.scrollIntoView({ block: 'start' })
      highlightedSearchTargetRef.current?.removeAttribute('data-settings-search-target')
      target.setAttribute('data-settings-search-target', 'true')
      highlightedSearchTargetRef.current = target

      if (searchHighlightTimeoutRef.current !== null) {
        window.clearTimeout(searchHighlightTimeoutRef.current)
      }
      searchHighlightTimeoutRef.current = window.setTimeout(() => {
        target.removeAttribute('data-settings-search-target')
        if (highlightedSearchTargetRef.current === target) {
          highlightedSearchTargetRef.current = null
        }
        searchHighlightTimeoutRef.current = null
      }, 1600)
    })
  }

  useEffect(() => {
    return () => {
      if (searchHighlightTimeoutRef.current !== null) {
        window.clearTimeout(searchHighlightTimeoutRef.current)
      }
      highlightedSearchTargetRef.current?.removeAttribute('data-settings-search-target')
    }
  }, [])

  const pageTitle = activeWorkspace
    ? activeWorkspace.name.trim() || getFolderName(activeWorkspace.path)
    : t(resolvedActivePage.navLabelKey ?? 'settingsPanel.title')
  const pageDescription = activeWorkspace
    ? activeWorkspace.path
    : resolvedActivePage.descriptionKey
      ? t(resolvedActivePage.descriptionKey)
      : ''

  return (
    <div
      className={`settings-backdrop${isFocusNodeTargetZoomPreviewing ? ' settings-backdrop--preview' : ''}`}
      onClick={onClose}
    >
      <section
        ref={panelRef}
        className={`settings-panel${isFocusNodeTargetZoomPreviewing ? ' settings-panel--preview' : ''}`}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="settings-panel-page-title"
        aria-describedby={pageDescription ? 'settings-panel-page-description' : undefined}
        data-testid="settings-panel"
        onClick={e => e.stopPropagation()}
        onKeyDown={event => {
          const target = event.target
          if (
            event.key !== 'Escape' ||
            event.defaultPrevented ||
            (target instanceof Element && target.closest('.cove-window'))
          ) {
            return
          }
          event.preventDefault()
          onClose()
        }}
      >
        <SettingsPanelSidebar
          activePageId={activePageId}
          workspaces={workspaces}
          endpointsEnabled={settings.experimentalRemoteWorkersEnabled}
          onSelectPage={setActivePageId}
          onSelectSearchResult={selectSearchResult}
        />

        <div className="settings-panel__content-wrapper">
          <SettingsPanelHeader title={pageTitle} description={pageDescription} onClose={onClose} />
          <div className="settings-panel__content" ref={contentRef}>
            {canonicalPageId === 'general' ? (
              <GeneralSection
                language={settings.language}
                updatePolicy={settings.updatePolicy}
                updateChannel={settings.updateChannel}
                updateState={updateState}
                onChangeLanguage={updateLanguage}
                onChangeUpdatePolicy={updateUpdatePolicy}
                onChangeUpdateChannel={updateUpdateChannel}
                onCheckForUpdates={onCheckForUpdates}
                onDownloadUpdate={onDownloadUpdate}
                onInstallUpdate={onInstallUpdate}
              />
            ) : null}

            {canonicalPageId === 'appearance' ? (
              <AppearanceSection
                uiTheme={settings.uiTheme}
                uiFontSize={settings.uiFontSize}
                terminalFontSize={settings.terminalFontSize}
                terminalFontFamily={settings.terminalFontFamily}
                terminalDisplayAutoReferenceEnabled={settings.terminalDisplayAutoReferenceEnabled}
                terminalDisplayCalibrationCompensationEnabled={
                  settings.terminalDisplayCalibrationCompensationEnabled
                }
                terminalDisplayReference={settings.terminalDisplayReference}
                onChangeUiTheme={updateUiTheme}
                onChangeUiFontSize={updateUiFontSize}
                onChangeTerminalFontSize={updateTerminalFontSize}
                onChangeTerminalFontFamily={updateTerminalFontFamily}
                onChangeTerminalDisplayAutoReferenceEnabled={updateTerminalAutoReference}
                onChangeTerminalDisplayCalibrationCompensationEnabled={updateTerminalCompensation}
                onChangeTerminalDisplayReference={updateTerminalDisplayReference}
              />
            ) : null}

            {canonicalPageId === 'worker' ? (
              <WorkerConnectionsSection
                remoteWorkersEnabled={settings.experimentalRemoteWorkersEnabled}
                onChangeRemoteWorkersEnabled={updateExperimentalRemoteWorkersEnabled}
              />
            ) : null}

            {canonicalPageId === 'agent' ? (
              <AgentSettingsPage
                settings={settings}
                modelCatalogByProvider={modelCatalogByProvider}
                addModelInputByProvider={addModelInputByProvider}
                onChangeDefaultProvider={updateDefaultProvider}
                onChangeAgentProviderOrder={updateAgentProviderOrder}
                onChangeAgentFullAccess={updateAgentFullAccess}
                onToggleCustomModelEnabled={updateProviderCustomModelEnabled}
                onSelectProviderModel={selectProviderModel}
                onRemoveCustomModelOption={removeCustomModelOption}
                onChangeAddModelInput={updateAddModelInput}
                onAddCustomModelOption={addCustomModelOption}
                onChangeAgentEnvByProvider={updateAgentEnvByProvider}
              />
            ) : null}

            {canonicalPageId === 'notifications' ? (
              <NotificationsSection
                systemNotificationsEnabled={settings.systemNotificationsEnabled}
                standbyBannerEnabled={settings.standbyBannerEnabled}
                standbyBannerShowTask={settings.standbyBannerShowTask}
                standbyBannerShowSpace={settings.standbyBannerShowSpace}
                standbyBannerShowBranch={settings.standbyBannerShowBranch}
                standbyBannerShowPullRequest={settings.standbyBannerShowPullRequest}
                githubPullRequestsEnabled={settings.githubPullRequestsEnabled}
                onChangeSystemNotificationsEnabled={updateSystemNotificationsEnabled}
                onChangeStandbyBannerEnabled={updateStandbyBannerEnabled}
                onChangeStandbyBannerShowTask={updateStandbyBannerShowTask}
                onChangeStandbyBannerShowSpace={updateStandbyBannerShowSpace}
                onChangeStandbyBannerShowBranch={updateStandbyBannerShowBranch}
                onChangeStandbyBannerShowPullRequest={updateStandbyBannerShowPullRequest}
              />
            ) : null}

            {canonicalPageId === 'integrations' ? (
              <IntegrationsSection
                githubPullRequestsEnabled={settings.githubPullRequestsEnabled}
                onChangeGitHubPullRequestsEnabled={updateGitHubPullRequestsEnabled}
              />
            ) : null}

            {canonicalPageId === 'canvas-windows' ? (
              <CanvasWindowsSection
                canvasInputMode={settings.canvasInputMode}
                canvasWheelBehavior={settings.canvasWheelBehavior}
                canvasWheelZoomModifier={settings.canvasWheelZoomModifier}
                standardWindowSizeBucket={settings.standardWindowSizeBucket}
                focusNodeOnClick={settings.focusNodeOnClick}
                focusNodeTargetZoom={settings.focusNodeTargetZoom}
                focusNodeUseVisibleCanvasCenter={settings.focusNodeUseVisibleCanvasCenter}
                archiveSpaceDeleteWorktreeByDefault={settings.archiveSpaceDeleteWorktreeByDefault}
                archiveSpaceDeleteBranchByDefault={settings.archiveSpaceDeleteBranchByDefault}
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
                onChangeArchiveSpaceDeleteWorktreeByDefault={
                  updateArchiveSpaceDeleteWorktreeByDefault
                }
                onChangeArchiveSpaceDeleteBranchByDefault={updateArchiveSpaceDeleteBranchByDefault}
                onFocusNodeTargetZoomPreviewChange={onFocusNodeTargetZoomPreviewChange}
              />
            ) : null}

            {canonicalPageId === 'advanced' ? (
              <AdvancedSection
                websiteWindowPolicy={settings.websiteWindowPolicy}
                browserDefaultMode={settings.browserDefaultMode}
                browserSearchEngine={settings.browserSearchEngine}
                websiteWindowPasteEnabled={settings.experimentalWebsiteWindowPasteEnabled}
                performanceMonitorHeaderButtonEnabled={
                  settings.performanceMonitorHeaderButtonEnabled
                }
                onChangeWebsiteWindowPolicy={updateWebsiteWindowPolicy}
                onChangeBrowserDefaultMode={updateBrowserDefaultMode}
                onChangeBrowserSearchEngine={updateBrowserSearchEngine}
                onChangeWebsiteWindowPasteEnabled={updateExperimentalWebsiteWindowPasteEnabled}
                onChangePerformanceMonitorHeaderButtonEnabled={
                  updatePerformanceMonitorHeaderButtonEnabled
                }
              />
            ) : null}

            {canonicalPageId === 'tasks-shortcuts' ? (
              <TasksAndShortcutsSection
                showTaskTitleGeneration={AI_NAMING_FEATURES.taskTitleGeneration}
                defaultProvider={settings.defaultProvider}
                taskTitleProvider={settings.taskTitleProvider}
                taskTitleModel={settings.taskTitleModel}
                effectiveTaskTitleProvider={effectiveTaskTitleProvider}
                tags={settings.taskTagOptions}
                addTaskTagInput={addTaskTagInput}
                quickCommands={settings.quickCommands}
                quickPhrases={settings.quickPhrases}
                disableAppShortcutsWhenTerminalFocused={
                  settings.disableAppShortcutsWhenTerminalFocused
                }
                keybindings={settings.keybindings}
                onChangeTaskTitleProvider={updateTaskTitleProvider}
                onChangeTaskTitleModel={updateTaskTitleModel}
                onChangeAddTaskTagInput={setAddTaskTagInput}
                onAddTag={addTaskTagOption}
                onRemoveTag={removeTaskTagOption}
                onChangeQuickCommands={updateQuickCommands}
                onChangeQuickPhrases={updateQuickPhrases}
                onChangeDisableAppShortcutsWhenTerminalFocused={
                  updateDisableAppShortcutsWhenTerminalFocused
                }
                onChangeKeybindings={updateKeybindings}
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
                environmentVariables={activeWorkspace.environmentVariables ?? {}}
                onChangeEnvironmentVariables={envVars =>
                  onWorkspaceEnvironmentVariablesChange(activeWorkspace.id, envVars)
                }
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
