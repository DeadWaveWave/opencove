import { subscribePluginCommandFeedback } from '@contexts/plugins/presentation/renderer/pluginCommandFeedback'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence'
import { EndpointOverviewProvider } from './components/EndpointOverviewProvider'
import { AppHeader } from './components/AppHeader'
import { AppShellBootBoundary } from './components/AppShellBootBoundary'
import { AppShellFrame } from './components/AppShellFrame'
import { AppShellOverlays } from './components/AppShellOverlays'
import { AppSettingsPage } from './components/AppSettingsPage'
import { WhatsNewDialog } from './components/WhatsNewDialog'
import { AppShellPopups } from './components/AppShellPopups'
import { AppPrimarySidebar } from './components/AppPrimarySidebar'
import { WorkspaceDirectoryPickerBridge } from './components/WorkspaceDirectoryPickerBridge'
import { WorkspaceMain } from './components/WorkspaceMain'
import { WorkspaceSearchOverlay } from './components/WorkspaceSearchOverlay'
import { useHydrateAppState } from './hooks/useHydrateAppState'
import { useApplyUiFontScale } from './hooks/useApplyUiFontScale'
import { useApplyWindowAppearance } from './hooks/useApplyWindowAppearance'
import { useApplyUiTheme } from './hooks/useApplyUiTheme'
import { useApplyUiLanguage } from './hooks/useApplyUiLanguage'
import { useAppDocumentChrome } from './hooks/useAppDocumentChrome'
import { usePersistedAppState } from './hooks/usePersistedAppState'
import { useProjectContextMenuDismiss } from './hooks/useProjectContextMenuDismiss'
import { useProviderModelCatalog } from './hooks/useProviderModelCatalog'
import { useAppKeybindings } from './hooks/useAppKeybindings'
import { useAppHeaderActivity } from './hooks/useAppHeaderActivity'
import { useAgentStandbyNotifications } from './hooks/useAgentStandbyNotifications'
import { useFloatingMessage } from './hooks/useFloatingMessage'
import { useQuitShortcutHint } from './hooks/useQuitShortcutHint'
import { useWorkspaceStateHandlers } from './hooks/useWorkspaceStateHandlers'
import { useAppUpdates } from './hooks/useAppUpdates'
import { useAppShellWorkspaceActions } from './hooks/useAppShellWorkspaceActions'
import { useShellOverlayState } from './hooks/useShellOverlayState'
import { useShellPerformanceDiagnostics } from './hooks/useShellPerformanceDiagnostics'
import { useAddProjectRequest } from './hooks/useAddProjectWizardRequest'
import { useWhatsNew } from './hooks/useWhatsNew'
import { useAppShellRuntimeLifecycles } from './hooks/useAppShellRuntimeLifecycles'
import { usePrimarySidebar } from './hooks/usePrimarySidebar'
import { useWebsiteWindowOcclusionSync } from './hooks/useWebsiteWindowOcclusionSync'
import { useCommandCenterShortcutHint } from './hooks/useCommandCenterShortcutHint'
import { useAppStore } from './store/useAppStore'
import { useSettingsPageNavigation } from './hooks/useSettingsPageNavigation'
import { useIssueReportUiDiagnostics } from './hooks/useIssueReportUiDiagnostics'

export default function App(): React.JSX.Element {
  useIssueReportUiDiagnostics()
  const { t } = useTranslation()
  const performanceDiagnostics = useShellPerformanceDiagnostics()
  const {
    workspaces,
    activeWorkspaceId,
    projectContextMenu,
    projectMountManager,
    projectDeleteConfirmation,
    isRemovingProject,
    agentSettings,
    isSettingsOpen,
    settingsOpenPageId,
    focusRequest,
    setWorkspaces,
    setActiveWorkspaceId,
    setProjectContextMenu,
    setProjectMountManager,
    setProjectDeleteConfirmation,
    setAgentSettings,
  } = useAppStore()

  const { isPersistReady } = useHydrateAppState({
    activeWorkspaceId,
    setAgentSettings,
    setWorkspaces,
    setActiveWorkspaceId,
  })

  const { providerModelCatalog } = useProviderModelCatalog({
    isSettingsOpen,
    agentSettings,
  })

  useApplyUiFontScale(agentSettings.uiFontSize)
  useApplyWindowAppearance(agentSettings)
  useApplyUiTheme(agentSettings.uiTheme)
  useApplyUiLanguage(agentSettings.language)

  const producePersistedState = useCallback(() => {
    const state = useAppStore.getState()
    return toPersistedState(state.workspaces, state.activeWorkspaceId, state.agentSettings)
  }, [])

  const { persistNotice, requestPersistFlush, flushPersistNow } = usePersistedAppState({
    workspaces,
    activeWorkspaceId,
    agentSettings,
    isHydrated: isPersistReady,
    producePersistedState,
  })

  const { floatingMessage: generalFloatingMessage, showMessage: handleShowMessage } =
    useFloatingMessage()
  useEffect(() => subscribePluginCommandFeedback(handleShowMessage), [handleShowMessage])
  const floatingMessage = useQuitShortcutHint() ?? generalFloatingMessage
  const agentAttention = useAgentStandbyNotifications()

  const terminalDisplayCalibration = useAppShellRuntimeLifecycles({
    isPersistReady,
    workspaces,
    requestPersistFlush,
    agentSettings,
    setAgentSettings,
  })

  const activeWorkspace = useMemo(
    () => workspaces.find(workspace => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  )
  useAppDocumentChrome(activeWorkspace?.name ?? null)

  const isPrimarySidebarCollapsed = agentSettings.isPrimarySidebarCollapsed === true
  const sidebarTriggerRef = useRef<HTMLButtonElement | null>(null)
  const toggleSidebarPinned = useCallback(() => {
    setAgentSettings(prev => ({
      ...prev,
      isPrimarySidebarCollapsed: !prev.isPrimarySidebarCollapsed,
    }))
  }, [setAgentSettings])
  const handleChangePreserveWindowSizesOnArrange = useCallback(
    (enabled: boolean) => {
      setAgentSettings(previous =>
        previous.preserveWindowSizesOnArrange === enabled
          ? previous
          : { ...previous, preserveWindowSizesOnArrange: enabled },
      )
    },
    [setAgentSettings],
  )

  const controlCenterButtonRef = useRef<HTMLButtonElement | null>(null)
  const agentPillRef = useRef<HTMLButtonElement | null>(null)
  const {
    isCommandCenterOpen,
    isControlCenterOpen,
    isPerformanceMonitorOpen,
    isIssueReportOpen,
    isWorkspaceSearchOpen,
    isSpaceArchivesOpen,
    isAddProjectWizardOpen,
    isAgentActivityOpen,
    addProjectWizardAnchor,
    hasBlockingOverlay,
    toggleCommandCenter,
    closeCommandCenter,
    toggleControlCenter,
    closeControlCenter,
    togglePerformanceMonitor,
    closePerformanceMonitor,
    toggleIssueReport,
    closeIssueReport,
    openWorkspaceSearch,
    closeWorkspaceSearch,
    openSpaceArchives,
    closeSpaceArchives,
    openAddProjectWizard,
    closeAddProjectWizard,
    setAgentActivityOpen,
    closeTransientOverlays,
  } = useShellOverlayState()

  const hasBlockingShellOverlay =
    hasBlockingOverlay || projectMountManager !== null || projectDeleteConfirmation !== null

  const sidebar = usePrimarySidebar({
    isCollapsed: isPrimarySidebarCollapsed,
    hasBlockingOverlay: hasBlockingShellOverlay || isAddProjectWizardOpen,
    onTogglePinned: toggleSidebarPinned,
  })
  // The agent list drops over the canvas, so native website views must step aside for it too.
  useWebsiteWindowOcclusionSync(
    isSettingsOpen || hasBlockingShellOverlay || sidebar.isDrawerOpen || isAgentActivityOpen,
  )
  const {
    isFocusNodeTargetZoomPreviewing,
    setFocusNodeZoomPreviewing,
    settingsInitialPageId,
    handleOpenSettings,
    handleCloseSettings,
  } = useSettingsPageNavigation({
    closeTransientOverlays,
    closeSidebar: sidebar.close,
    flushPersistNow,
  })

  useAppKeybindings({
    enabled: isPersistReady && !isIssueReportOpen && projectDeleteConfirmation === null,
    settings: {
      disableAppShortcutsWhenTerminalFocused: agentSettings.disableAppShortcutsWhenTerminalFocused,
      keybindings: agentSettings.keybindings,
    },
    onToggleCommandCenter: toggleCommandCenter,
    onOpenSettings: handleOpenSettings,
    onTogglePrimarySidebar: () => {
      closeTransientOverlays()
      sidebar.toggle()
    },
    onAddProject: () => {
      closeTransientOverlays()
      void handleAddWorkspace()
    },
    onOpenWorkspaceSearch: () => {
      handleCloseSettings()
      openWorkspaceSearch()
    },
    workspaceIds: workspaces.map(workspace => workspace.id),
    onSelectWorkspace: workspaceId => handleSelectWorkspace(workspaceId),
  })

  useEffect(() => {
    if (!isSettingsOpen && projectDeleteConfirmation === null) {
      return
    }

    closeTransientOverlays()
  }, [closeTransientOverlays, isSettingsOpen, projectDeleteConfirmation])

  useEffect(() => {
    if (!agentSettings.performanceMonitorHeaderButtonEnabled) {
      closePerformanceMonitor()
    }
  }, [agentSettings.performanceMonitorHeaderButtonEnabled, closePerformanceMonitor])

  const commandCenterShortcutHint = useCommandCenterShortcutHint(agentSettings.keybindings)
  const headerActivity = useAppHeaderActivity(workspaces, activeWorkspace)

  const { updateState, checkForUpdates, downloadUpdate, installUpdate } = useAppUpdates({
    policy: agentSettings.updatePolicy,
    channel: agentSettings.updateChannel,
    onShowMessage: handleShowMessage,
  })

  const whatsNew = useWhatsNew({
    isPersistReady,
    updateState,
    settings: agentSettings,
    onChangeSettings: setAgentSettings,
  })

  const requestAddWorkspace = useAddProjectRequest(openAddProjectWizard, setFocusNodeZoomPreviewing)
  const handleAddWorkspace = () => {
    handleCloseSettings()
    requestAddWorkspace()
  }

  const {
    handleWorkspaceViewportChange,
    handleWorkspaceMinimapVisibilityChange,
    handleWorkspaceActiveSpaceChange,
    handleWorkspaceSpaceArchiveRecordAppend,
    handleWorkspaceSpaceArchiveRecordRemove,
    handleAnyWorkspaceWorktreesRootChange,
    handleAnyWorkspaceEnvironmentVariablesChange,
  } = useWorkspaceStateHandlers({ requestPersistFlush })

  const {
    handleRemoveWorkspace,
    handleSelectWorkspace,
    handleSelectProjectCanvas,
    handleSelectAgentNode,
    handleSelectSpace,
    handleRequestRemoveProject,
    handleRequestManageProjectMounts,
    handleRequestOpenProjectInFileManager,
    handleReorderWorkspaces,
    handleReorderWorkspaceRootSpaces,
    handleReorderWorkspaceSidebarAgents,
  } = useAppShellWorkspaceActions({ requestPersistFlush, t, showMessage: handleShowMessage })

  useProjectContextMenuDismiss({
    projectContextMenu,
    setProjectContextMenu,
  })

  return (
    <AppShellBootBoundary isBootReady={isPersistReady}>
      <EndpointOverviewProvider>
        <AppShellFrame isSidebarCollapsed={isPrimarySidebarCollapsed} sidebar={sidebar}>
          <AppHeader
            sidebarTriggerRef={sidebarTriggerRef}
            sidebarIsDrawer={sidebar.isMobile}
            isSidebarOpen={sidebar.isOpen}
            onToggleSidebar={sidebar.toggle}
            activeWorkspaceName={activeWorkspace?.name ?? null}
            activeWorkspacePath={activeWorkspace?.path ?? null}
            {...headerActivity}
            onFocusAgentNode={handleSelectAgentNode}
            isAgentActivityOpen={isAgentActivityOpen}
            onAgentActivityOpenChange={setAgentActivityOpen}
            agentPillRef={agentPillRef}
            isControlCenterOpen={isControlCenterOpen}
            isCommandCenterOpen={isCommandCenterOpen}
            isPerformanceMonitorEnabled={agentSettings.performanceMonitorHeaderButtonEnabled}
            isPerformanceMonitorOpen={isPerformanceMonitorOpen}
            isIssueReportOpen={isIssueReportOpen}
            commandCenterShortcutHint={commandCenterShortcutHint}
            {...performanceDiagnostics}
            updateState={updateState}
            controlCenterButtonRef={controlCenterButtonRef}
            onToggleControlCenter={toggleControlCenter}
            onToggleCommandCenter={toggleCommandCenter}
            onTogglePerformanceMonitor={togglePerformanceMonitor}
            onClosePerformanceMonitor={closePerformanceMonitor}
            onToggleIssueReport={toggleIssueReport}
            onCloseIssueReport={closeIssueReport}
            onCheckForUpdates={checkForUpdates}
            onDownloadUpdate={downloadUpdate}
            onInstallUpdate={installUpdate}
          />

          <AppPrimarySidebar
            controller={sidebar}
            isMenuOpen={projectContextMenu !== null}
            triggerRef={sidebarTriggerRef}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            persistNotice={persistNotice}
            onAddProject={handleAddWorkspace}
            onOpenSettings={handleOpenSettings}
            onSelectWorkspace={handleSelectWorkspace}
            onSelectProjectCanvas={workspaceId => {
              handleSelectProjectCanvas(workspaceId)
              sidebar.close()
            }}
            onSelectSpace={(workspaceId, spaceId) => {
              handleSelectSpace(workspaceId, spaceId)
              sidebar.close()
            }}
            onOpenProjectContextMenu={setProjectContextMenu}
            onSelectAgentNode={(workspaceId, nodeId) => {
              handleSelectAgentNode(workspaceId, nodeId, { focusInput: !sidebar.isMobile })
              sidebar.close()
            }}
            currentNodeId={focusRequest?.kind === 'node' ? focusRequest.nodeId : null}
            onReorderWorkspaces={handleReorderWorkspaces}
            onReorderWorkspaceRootSpaces={handleReorderWorkspaceRootSpaces}
            onReorderWorkspaceSidebarAgents={handleReorderWorkspaceSidebarAgents}
          />

          <WorkspaceMain
            activeWorkspace={activeWorkspace}
            agentSettings={agentSettings}
            terminalDisplayCalibration={terminalDisplayCalibration}
            focusRequest={focusRequest}
            isFocusNodeTargetZoomPreviewing={isSettingsOpen && isFocusNodeTargetZoomPreviewing}
            isSettingsPageOpen={isSettingsOpen}
            shortcutsEnabled={
              isPersistReady && !isSettingsOpen && !hasBlockingShellOverlay && !sidebar.isDrawerOpen
            }
            onAddWorkspace={handleAddWorkspace}
            onShowMessage={handleShowMessage}
            onRequestPersistFlush={requestPersistFlush}
            onAppendSpaceArchiveRecord={handleWorkspaceSpaceArchiveRecordAppend}
            onViewportChange={handleWorkspaceViewportChange}
            onMinimapVisibilityChange={handleWorkspaceMinimapVisibilityChange}
            onChangePreserveWindowSizesOnArrange={handleChangePreserveWindowSizesOnArrange}
            onActiveSpaceChange={handleWorkspaceActiveSpaceChange}
            onOpenProjectContextMenu={setProjectContextMenu}
          />

          <AppSettingsPage
            isSettingsOpen={isSettingsOpen}
            settingsInitialPageId={settingsInitialPageId}
            openSettingsPageId={settingsOpenPageId}
            settings={agentSettings}
            updateState={updateState}
            modelCatalogByProvider={providerModelCatalog}
            workspaces={workspaces}
            onWorkspaceWorktreesRootChange={handleAnyWorkspaceWorktreesRootChange}
            onWorkspaceEnvironmentVariablesChange={handleAnyWorkspaceEnvironmentVariablesChange}
            isFocusNodeTargetZoomPreviewing={isFocusNodeTargetZoomPreviewing}
            onFocusNodeTargetZoomPreviewChange={setFocusNodeZoomPreviewing}
            onChangeSettings={setAgentSettings}
            onCheckForUpdates={checkForUpdates}
            onDownloadUpdate={downloadUpdate}
            onInstallUpdate={installUpdate}
            onCloseSettings={handleCloseSettings}
          />

          <WorkspaceSearchOverlay
            isOpen={isWorkspaceSearchOpen}
            activeWorkspace={activeWorkspace}
            onClose={closeWorkspaceSearch}
            onSelectSpace={handleWorkspaceActiveSpaceChange}
            panelWidth={agentSettings.workspaceSearchPanelWidth}
            onPanelWidthChange={nextWidth => {
              setAgentSettings(prev => ({
                ...prev,
                workspaceSearchPanelWidth: nextWidth,
              }))
            }}
          />
        </AppShellFrame>

        <AppShellOverlays
          floatingMessage={floatingMessage}
          notifications={agentAttention.notifications}
          agentActivity={headerActivity.agentActivity}
          agentPillRef={agentPillRef}
          isAgentListOpen={isAgentActivityOpen}
          dismissNotification={agentAttention.dismiss}
          resolveSystemNotificationTarget={agentAttention.resolveSystemNotificationTarget}
          onFocusAgentNode={handleSelectAgentNode}
          agentSettings={agentSettings}
          setAgentSettings={setAgentSettings}
          activeWorkspace={activeWorkspace}
          isControlCenterOpen={isControlCenterOpen}
          controlCenterAnchorRef={controlCenterButtonRef}
          onCloseControlCenter={closeControlCenter}
          onMinimapVisibilityChange={handleWorkspaceMinimapVisibilityChange}
          onOpenSettings={handleOpenSettings}
        />
        <AppShellPopups
          isCommandCenterOpen={isCommandCenterOpen}
          activeWorkspace={activeWorkspace}
          workspaces={workspaces}
          isPrimarySidebarCollapsed={isPrimarySidebarCollapsed}
          remoteWorkersEnabled
          onCloseCommandCenter={closeCommandCenter}
          onOpenWorkspaceSearch={() => {
            handleCloseSettings()
            openWorkspaceSearch()
          }}
          onOpenSettings={handleOpenSettings}
          onRequestOpenEndpoints={() => {
            handleOpenSettings('endpoints')
          }}
          onOpenSpaceArchives={openSpaceArchives}
          onTogglePrimarySidebar={sidebar.toggle}
          onAddWorkspace={handleAddWorkspace}
          onSelectWorkspace={handleSelectWorkspace}
          onSelectSpace={spaceId => {
            handleCloseSettings()
            handleWorkspaceActiveSpaceChange(spaceId)
          }}
          onSelectNode={handleSelectAgentNode}
          isSpaceArchivesOpen={isSpaceArchivesOpen}
          canvasInputModeSetting={agentSettings.canvasInputMode}
          canvasWheelBehaviorSetting={agentSettings.canvasWheelBehavior}
          canvasWheelZoomModifierSetting={agentSettings.canvasWheelZoomModifier}
          onDeleteSpaceArchiveRecord={handleWorkspaceSpaceArchiveRecordRemove}
          onCloseSpaceArchives={closeSpaceArchives}
          isAddProjectWizardOpen={isAddProjectWizardOpen}
          addProjectWizardAnchor={addProjectWizardAnchor}
          onCloseAddProjectWizard={closeAddProjectWizard}
          projectContextMenu={projectContextMenu}
          projectMountManager={projectMountManager}
          onCloseProjectMountManager={() => {
            setProjectMountManager(null)
          }}
          onRequestManageProjectMounts={handleRequestManageProjectMounts}
          onRequestOpenProjectInFileManager={handleRequestOpenProjectInFileManager}
          onRequestRemoveProject={handleRequestRemoveProject}
          projectDeleteConfirmation={projectDeleteConfirmation}
          isRemovingProject={isRemovingProject}
          onCancelProjectDelete={() => {
            setProjectDeleteConfirmation(null)
          }}
          onConfirmProjectDelete={() => {
            if (projectDeleteConfirmation) {
              void handleRemoveWorkspace(projectDeleteConfirmation.workspaceId)
            }
          }}
        />
        <WhatsNewDialog {...whatsNew} onClose={whatsNew.close} />
        <WorkspaceDirectoryPickerBridge />
      </EndpointOverviewProvider>
    </AppShellBootBoundary>
  )
}
