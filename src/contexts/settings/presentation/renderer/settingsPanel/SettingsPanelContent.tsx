import React from 'react'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentProviderRequest } from '../useSettingsSearchNavigation'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import { useTerminalProfiles } from '@app/renderer/shell/hooks/useTerminalProfiles'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import {
  isWorkspacePageId,
  type SettingsPanelProps,
  type SettingsPageId,
} from '../SettingsPanel.shared'
import type { useSettingsPanelActions } from '../useSettingsPanelActions'
import { AdvancedSection } from './AdvancedSection'
import { CanvasWindowsSection } from './CanvasWindowsSection'
import { GeneralSection } from './GeneralSection'
import { AppearanceSection } from './AppearanceSection'
import { IntegrationsSection } from './IntegrationsSection'
import { PluginsSection } from './PluginsSection'
import { NotificationsSection } from './NotificationsSection'
import { QuickMenuSection } from './QuickMenuSection'
import { ShortcutsSection } from './ShortcutsSection'
import { TaskConfigurationSection } from './TaskConfigurationSection'
import { TerminalSettingsSection } from './TerminalSettingsSection'
import { AgentSettingsPage } from './AgentSettingsPage'
import { WorkerConnectionsSection } from './WorkerConnectionsSection'
import { WorkspaceSection } from './WorkspaceSection'

type Props = Pick<
  SettingsPanelProps,
  | 'settings'
  | 'updateState'
  | 'modelCatalogByProvider'
  | 'onWorkspaceWorktreesRootChange'
  | 'onWorkspaceEnvironmentVariablesChange'
  | 'onFocusNodeTargetZoomPreviewChange'
  | 'onCheckForUpdates'
  | 'onDownloadUpdate'
  | 'onInstallUpdate'
> & {
  activePageId: SettingsPageId
  canonicalPageId: SettingsPageId
  activeWorkspace: WorkspaceState | null
  actions: ReturnType<typeof useSettingsPanelActions>
  agentRequest: AgentProviderRequest
  onSelectPage: (pageId: SettingsPageId) => void
}

export function SettingsPanelContent({
  settings,
  updateState,
  modelCatalogByProvider,
  onWorkspaceWorktreesRootChange,
  onWorkspaceEnvironmentVariablesChange,
  onFocusNodeTargetZoomPreviewChange,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  activePageId,
  canonicalPageId,
  activeWorkspace,
  actions,
  agentRequest,
  onSelectPage,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { terminalProfiles, detectedDefaultTerminalProfileId } = useTerminalProfiles()
  const {
    updateDefaultProvider,
    updateAgentProviderOrder,
    updateLanguage,
    updateUiTheme,
    updateWindowKindColors,
    updateWindowMaterial,
    updateCanvasFarView,
    updatePixelEffect,
    updateCanvasBackgroundStyle,
    updatePluginEnabled,
    updatePluginContributionEnabled,
    updateAgentFullAccess,
    updateCodexReuseRunningAppServer,
    updateAgentResidentContext,
    updateDefaultTerminalProfileId,
    updateTaskTitleProvider,
    updateTaskTitleModel,
    updateViewportTransition,
    updateFocusNodeOnClick,
    updateFocusNodeTargetZoom,
    updateFocusNodeUseVisibleCanvasCenter,
    updateArchiveSpaceDeleteWorktreeByDefault,
    updateArchiveSpaceDeleteBranchByDefault,
    updateNotificationSetting,
    updateCanvasInputMode,
    updateCanvasWheelBehavior,
    updateCanvasWheelZoomModifier,
    updateStandardWindowSizeBucket,
    updateNodeExpandBehavior,
    updateWebsiteWindowPolicy,
    updateBrowserDefaultMode,
    updateBrowserSearchEngine,
    updateExperimentalWebsiteWindowPasteEnabled,
    updateTerminalFontSize,
    updateTerminalFontFamily,
    updateTerminalBackground,
    updateTerminalAutoReference,
    updateTerminalCompensation,
    updateTerminalDisplayReference,
    updateUiFontSize,
    updateUpdatePolicy,
    updateUpdateChannel,
    updateQuickCommands,
    updateQuickPhrases,
    updateAgentEnvByProvider,
    updateDisableAppShortcutsWhenTerminalFocused,
    updateKeybindings,
    updateGitHubPullRequestsEnabled,
    updatePerformanceMonitorHeaderButtonEnabled,
    addModelInputByProvider,
    addTaskTagInput,
    setAddTaskTagInput,
    removeTaskTagOption,
    addTaskTagOption,
    updateProviderCustomModelEnabled,
    selectProviderModel,
    removeCustomModelOption,
    updateAddModelInput,
    addCustomModelOption,
    effectiveTaskTitleProvider,
  } = actions
  return (
    <>
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
          pixelEffects={settings}
          uiFontSize={settings.uiFontSize}
          windowKindColorsEnabled={settings.windowKindColorsEnabled}
          onChangeWindowKindColors={updateWindowKindColors}
          windowMaterial={settings.windowMaterial}
          onChangeWindowMaterial={updateWindowMaterial}
          canvasFarViewEnabled={settings.canvasFarViewEnabled}
          onChangeCanvasFarView={updateCanvasFarView}
          onChangeUiTheme={updateUiTheme}
          onChangePixelEffect={updatePixelEffect}
          onChangeCanvasBackgroundStyle={updateCanvasBackgroundStyle}
          onChangeUiFontSize={updateUiFontSize}
        />
      ) : null}
      {canonicalPageId === 'terminal' ? (
        <TerminalSettingsSection
          terminalFontSize={settings.terminalFontSize}
          terminalFontFamily={settings.terminalFontFamily}
          terminalBackground={settings.terminalBackground}
          terminalDisplayAutoReferenceEnabled={settings.terminalDisplayAutoReferenceEnabled}
          terminalDisplayCalibrationCompensationEnabled={
            settings.terminalDisplayCalibrationCompensationEnabled
          }
          terminalDisplayReference={settings.terminalDisplayReference}
          onChangeTerminalFontSize={updateTerminalFontSize}
          onChangeTerminalFontFamily={updateTerminalFontFamily}
          onChangeTerminalBackground={updateTerminalBackground}
          onChangeTerminalDisplayAutoReferenceEnabled={updateTerminalAutoReference}
          onChangeTerminalDisplayCalibrationCompensationEnabled={updateTerminalCompensation}
          onChangeTerminalDisplayReference={updateTerminalDisplayReference}
          defaultTerminalProfileId={settings.defaultTerminalProfileId}
          terminalProfiles={terminalProfiles}
          detectedDefaultTerminalProfileId={detectedDefaultTerminalProfileId}
          onChangeDefaultTerminalProfileId={updateDefaultTerminalProfileId}
        />
      ) : null}

      {canonicalPageId === 'worker' ? <WorkerConnectionsSection /> : null}

      {canonicalPageId === 'plugins' ? (
        <PluginsSection
          settings={settings}
          onChangePluginEnabled={updatePluginEnabled}
          onChangePluginContributionEnabled={updatePluginContributionEnabled}
        />
      ) : null}

      {canonicalPageId === 'agent' ? (
        <>
          {/* Settings switch views with a segmented control, never a tab bar (Tide settings). */}
          <SegmentedControl
            className="settings-panel__view-switch"
            label={t('settingsPanel.nav.agent')}
            value={activePageId === 'task-configuration' ? 'task-configuration' : 'agent'}
            onValueChange={onSelectPage}
            options={[
              {
                value: 'agent',
                label: t('settingsPanel.navigation.providersTab'),
                testId: 'settings-agent-tab-providers',
              },
              {
                value: 'task-configuration',
                label: t('settingsPanel.navigation.tasksTab'),
                testId: 'settings-agent-tab-tasks',
              },
            ]}
          />
          {activePageId === 'task-configuration' ? (
            <TaskConfigurationSection
              showTaskTitleGeneration={AI_NAMING_FEATURES.taskTitleGeneration}
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
          ) : (
            <AgentSettingsPage
              requestedProvider={agentRequest.provider}
              requestKey={agentRequest.key}
              settings={settings}
              modelCatalogByProvider={modelCatalogByProvider}
              addModelInputByProvider={addModelInputByProvider}
              onChangeDefaultProvider={updateDefaultProvider}
              onChangeAgentProviderOrder={updateAgentProviderOrder}
              onChangeAgentFullAccess={updateAgentFullAccess}
              onChangeAgentResidentContext={updateAgentResidentContext}
              onChangeCodexReuseRunningAppServer={updateCodexReuseRunningAppServer}
              onToggleCustomModelEnabled={updateProviderCustomModelEnabled}
              onSelectProviderModel={selectProviderModel}
              onRemoveCustomModelOption={removeCustomModelOption}
              onChangeAddModelInput={updateAddModelInput}
              onAddCustomModelOption={addCustomModelOption}
              onChangeAgentEnvByProvider={updateAgentEnvByProvider}
            />
          )}
        </>
      ) : null}

      {canonicalPageId === 'general' ? (
        <NotificationsSection settings={settings} onChange={updateNotificationSetting} />
      ) : null}

      {canonicalPageId === 'worker' ? (
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
          nodeExpandBehavior={settings.nodeExpandBehavior}
          viewportTransition={settings.viewportTransition}
          onChangeViewportTransition={updateViewportTransition}
          focusNodeOnClick={settings.focusNodeOnClick}
          focusNodeTargetZoom={settings.focusNodeTargetZoom}
          focusNodeUseVisibleCanvasCenter={settings.focusNodeUseVisibleCanvasCenter}
          archiveSpaceDeleteWorktreeByDefault={settings.archiveSpaceDeleteWorktreeByDefault}
          archiveSpaceDeleteBranchByDefault={settings.archiveSpaceDeleteBranchByDefault}
          onChangeCanvasInputMode={updateCanvasInputMode}
          onChangeCanvasWheelBehavior={updateCanvasWheelBehavior}
          onChangeCanvasWheelZoomModifier={updateCanvasWheelZoomModifier}
          onChangeStandardWindowSizeBucket={updateStandardWindowSizeBucket}
          onChangeNodeExpandBehavior={updateNodeExpandBehavior}
          onChangeFocusNodeOnClick={updateFocusNodeOnClick}
          onChangeFocusNodeTargetZoom={updateFocusNodeTargetZoom}
          onChangeFocusNodeUseVisibleCanvasCenter={updateFocusNodeUseVisibleCanvasCenter}
          onChangeArchiveSpaceDeleteWorktreeByDefault={updateArchiveSpaceDeleteWorktreeByDefault}
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
          performanceMonitorHeaderButtonEnabled={settings.performanceMonitorHeaderButtonEnabled}
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
        <>
          <QuickMenuSection
            quickCommands={settings.quickCommands}
            quickPhrases={settings.quickPhrases}
            onChangeQuickCommands={updateQuickCommands}
            onChangeQuickPhrases={updateQuickPhrases}
          />
          <ShortcutsSection
            disableAppShortcutsWhenTerminalFocused={settings.disableAppShortcutsWhenTerminalFocused}
            keybindings={settings.keybindings}
            onChangeDisableAppShortcutsWhenTerminalFocused={
              updateDisableAppShortcutsWhenTerminalFocused
            }
            onChangeKeybindings={updateKeybindings}
          />
        </>
      ) : null}

      {isWorkspacePageId(activePageId) && activeWorkspace ? (
        <WorkspaceSection
          sectionId={`settings-section-workspace-${activeWorkspace.id}`}
          workspaceName={activeWorkspace.name}
          workspacePath={activeWorkspace.path}
          worktreesRoot={activeWorkspace.worktreesRoot}
          onChangeWorktreesRoot={root => onWorkspaceWorktreesRootChange(activeWorkspace.id, root)}
          environmentVariables={activeWorkspace.environmentVariables ?? {}}
          onChangeEnvironmentVariables={envVars =>
            onWorkspaceEnvironmentVariablesChange(activeWorkspace.id, envVars)
          }
        />
      ) : null}
    </>
  )
}
