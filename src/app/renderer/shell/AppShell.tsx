import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL, resolveAgentModel } from '@contexts/settings/domain/agentSettings'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence'
import { AppHeader } from './components/AppHeader'
import { AppShellBootBoundary } from './components/AppShellBootBoundary'
import { AppShellOverlays } from './components/AppShellOverlays'
import { AppShellModals } from './components/AppShellModals'
import { AppShellPopups } from './components/AppShellPopups'
import { Sidebar } from './components/Sidebar'
import { WorkspaceDirectoryPickerBridge } from './components/WorkspaceDirectoryPickerBridge'
import { WorkspaceMain } from './components/WorkspaceMain'
import { WorkspaceSearchOverlay } from './components/WorkspaceSearchOverlay'
import { useHydrateAppState } from './hooks/useHydrateAppState'
import { useApplyUiFontScale } from './hooks/useApplyUiFontScale'
import { useApplyUiTheme } from './hooks/useApplyUiTheme'
import { useApplyUiLanguage } from './hooks/useApplyUiLanguage'
import { useAppQuitPersistenceFlush } from './hooks/useAppQuitPersistenceFlush'
import { usePersistedAppState } from './hooks/usePersistedAppState'
import { usePtyWorkspaceRuntimeSync } from './hooks/usePtyWorkspaceRuntimeSync'
import { useProjectContextMenuDismiss } from './hooks/useProjectContextMenuDismiss'
import { useProviderModelCatalog } from './hooks/useProviderModelCatalog'
import { useAppKeybindings } from './hooks/useAppKeybindings'
import { useAgentStandbyNotifications } from './hooks/useAgentStandbyNotifications'
import { useFloatingMessage } from './hooks/useFloatingMessage'
import { useWorkspaceStateHandlers } from './hooks/useWorkspaceStateHandlers'
import { useAppUpdates } from './hooks/useAppUpdates'
import { useAppShellWorkspaceActions } from './hooks/useAppShellWorkspaceActions'
import { useShellOverlayState } from './hooks/useShellOverlayState'
import { useWhatsNew } from './hooks/useWhatsNew'
import { useWorkerSyncStateUpdates } from './hooks/useWorkerSyncStateUpdates'
import { useWorkspaceMountRepair } from './hooks/useWorkspaceMountRepair'
import { useWebsiteWindowEvents } from './hooks/useWebsiteWindowEvents'
import { useWebsiteWindowOcclusionSync } from './hooks/useWebsiteWindowOcclusionSync'
import { useWebsiteWindowPolicySync } from './hooks/useWebsiteWindowPolicySync'
import { useAppStore } from './store/useAppStore'
import { formatKeyChord, resolveCommandKeybinding } from '@contexts/settings/domain/keybindings'
import type { SettingsPageId } from '@contexts/settings/presentation/renderer/SettingsPanel.shared'
import { useTerminalDisplayReferenceAutoCapture } from '@contexts/settings/presentation/renderer/useTerminalDisplayReferenceAutoCapture'

export default function App(): React.JSX.Element {
  const { t } = useTranslation()
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
    setIsSettingsOpen,
    setSettingsOpenPageId,
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

  const { floatingMessage, showMessage: handleShowMessage } = useFloatingMessage()
  const { notifications: agentNotifications, dismiss: handleDismissAgentNotification } =
    useAgentStandbyNotifications()

  usePtyWorkspaceRuntimeSync({ requestPersistFlush })
  useAppQuitPersistenceFlush({ enabled: isPersistReady })
  useWorkerSyncStateUpdates({ enabled: isPersistReady })
  useWorkspaceMountRepair({ enabled: isPersistReady, workspaces, requestPersistFlush })
  useWebsiteWindowEvents()
  useWebsiteWindowPolicySync(agentSettings.websiteWindowPolicy)
  useTerminalDisplayReferenceAutoCapture({
    enabled: isPersistReady && agentSettings.terminalDisplayAutoReferenceEnabled,
    agentSettings,
    setAgentSettings,
  })

  const activeWorkspace = useMemo(
    () => workspaces.find(workspace => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  )

  const activeWorkspaceName = activeWorkspace?.name ?? null

  const isPrimarySidebarCollapsed = agentSettings.isPrimarySidebarCollapsed === true

  const [isFocusNodeTargetZoomPreviewing, setIsFocusNodeTargetZoomPreviewing] = useState(false)
  const [settingsInitialPageId, setSettingsInitialPageId] = useState<SettingsPageId | null>(null)
  const {
    isCommandCenterOpen,
    isControlCenterOpen,
    isIssueReportOpen,
    isWorkspaceSearchOpen,
    isSpaceArchivesOpen,
    isAddProjectWizardOpen,
    hasBlockingOverlay,
    toggleCommandCenter,
    closeCommandCenter,
    toggleControlCenter,
    closeControlCenter,
    toggleIssueReport,
    closeIssueReport,
    openWorkspaceSearch,
    closeWorkspaceSearch,
    openSpaceArchives,
    closeSpaceArchives,
    openAddProjectWizard,
    closeAddProjectWizard,
    closeTransientOverlays,
  } = useShellOverlayState()

  const hasBlockingShellOverlay =
    isSettingsOpen ||
    hasBlockingOverlay ||
    projectMountManager !== null ||
    projectDeleteConfirmation !== null

  useWebsiteWindowOcclusionSync(hasBlockingShellOverlay)

  useAppKeybindings({
    enabled:
      isPersistReady && !isSettingsOpen && !isIssueReportOpen && projectDeleteConfirmation === null,
    settings: {
      disableAppShortcutsWhenTerminalFocused: agentSettings.disableAppShortcutsWhenTerminalFocused,
      keybindings: agentSettings.keybindings,
    },
    onToggleCommandCenter: toggleCommandCenter,
    onOpenSettings: () => {
      closeTransientOverlays()
      setSettingsInitialPageId(null)
      setSettingsOpenPageId(null)
      setIsSettingsOpen(true)
    },
    onTogglePrimarySidebar: () => {
      closeTransientOverlays()
      setAgentSettings(prev => ({
        ...prev,
        isPrimarySidebarCollapsed: !prev.isPrimarySidebarCollapsed,
      }))
    },
    onAddProject: () => {
      closeTransientOverlays()
      void handleAddWorkspace()
    },
    onOpenWorkspaceSearch: () => {
      openWorkspaceSearch()
    },
  })

  useEffect(() => {
    if (!isSettingsOpen && projectDeleteConfirmation === null) {
      return
    }

    closeTransientOverlays()
  }, [closeTransientOverlays, isSettingsOpen, projectDeleteConfirmation])

  useEffect(() => {
    if (!isSettingsOpen) {
      setIsFocusNodeTargetZoomPreviewing(false)
    }
  }, [isSettingsOpen])

  useEffect(() => {
    document.title = activeWorkspaceName ? `${activeWorkspaceName} — OpenCove` : 'OpenCove'
  }, [activeWorkspaceName])

  const platform =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
      ? window.opencoveApi.meta.platform
      : undefined

  useEffect(() => {
    if (platform) {
      document.documentElement.dataset.covePlatform = platform
    }
  }, [platform])
  const commandCenterBindings = useMemo(
    () =>
      resolveCommandKeybinding({
        commandId: 'commandCenter.toggle',
        overrides: agentSettings.keybindings,
        platform,
      }),
    [agentSettings.keybindings, platform],
  )
  const commandCenterShortcutHint = formatKeyChord(platform, commandCenterBindings) || '—'

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

  const activeProviderLabel = AGENT_PROVIDER_LABEL[agentSettings.defaultProvider]
  const activeProviderModel =
    resolveAgentModel(agentSettings, agentSettings.defaultProvider) ?? t('common.defaultFollowCli')
  const handleAddWorkspace = useCallback((): void => {
    setIsFocusNodeTargetZoomPreviewing(false)
    openAddProjectWizard()
  }, [openAddProjectWizard])

  const {
    handleWorkspaceNodesChange,
    handleWorkspaceViewportChange,
    handleWorkspaceMinimapVisibilityChange,
    handleWorkspaceSpacesChange,
    handleWorkspaceActiveSpaceChange,
    handleWorkspaceSpaceArchiveRecordAppend,
    handleWorkspaceSpaceArchiveRecordRemove,
    handleAnyWorkspaceWorktreesRootChange,
    handleAnyWorkspaceEnvironmentVariablesChange,
  } = useWorkspaceStateHandlers({ requestPersistFlush })

  const {
    handleRemoveWorkspace,
    handleSelectWorkspace,
    handleSelectAgentNode,
    handleRequestRemoveProject,
    handleRequestManageProjectMounts,
    handleRequestOpenProjectInFileManager,
    handleReorderWorkspaces,
  } = useAppShellWorkspaceActions({ requestPersistFlush, t, showMessage: handleShowMessage })

  useProjectContextMenuDismiss({
    projectContextMenu,
    setProjectContextMenu,
  })

  const handleOpenSettings = useCallback(
    (initialPageId: SettingsPageId | null = null): void => {
      setIsFocusNodeTargetZoomPreviewing(false)
      setSettingsInitialPageId(initialPageId)
      closeTransientOverlays()
      setSettingsOpenPageId(null)
      setIsSettingsOpen(true)
    },
    [closeTransientOverlays, setIsSettingsOpen, setSettingsOpenPageId],
  )

  return (
    <AppShellBootBoundary isBootReady={isPersistReady}>
      <>
        <div
          className={`app-shell ${isPrimarySidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}`}
        >
          <AppHeader
            activeWorkspaceName={activeWorkspace?.name ?? null}
            activeWorkspacePath={activeWorkspace?.path ?? null}
            isSidebarCollapsed={isPrimarySidebarCollapsed}
            isControlCenterOpen={isControlCenterOpen}
            isCommandCenterOpen={isCommandCenterOpen}
            isIssueReportOpen={isIssueReportOpen}
            commandCenterShortcutHint={commandCenterShortcutHint}
            updateState={updateState}
            onToggleSidebar={() => {
              setAgentSettings(prev => ({
                ...prev,
                isPrimarySidebarCollapsed: !prev.isPrimarySidebarCollapsed,
              }))
            }}
            onToggleControlCenter={toggleControlCenter}
            onToggleCommandCenter={toggleCommandCenter}
            onToggleIssueReport={toggleIssueReport}
            onCloseIssueReport={closeIssueReport}
            onOpenSettings={handleOpenSettings}
            onCheckForUpdates={checkForUpdates}
            onDownloadUpdate={downloadUpdate}
            onInstallUpdate={installUpdate}
          />

          {isPrimarySidebarCollapsed ? null : (
            <Sidebar
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              activeProviderLabel={activeProviderLabel}
              activeProviderModel={activeProviderModel}
              persistNotice={persistNotice}
              onAddWorkspace={handleAddWorkspace}
              onSelectWorkspace={handleSelectWorkspace}
              onOpenProjectContextMenu={setProjectContextMenu}
              onSelectAgentNode={handleSelectAgentNode}
              onReorderWorkspaces={handleReorderWorkspaces}
            />
          )}

          <WorkspaceMain
            activeWorkspace={activeWorkspace}
            agentSettings={agentSettings}
            focusRequest={focusRequest}
            isFocusNodeTargetZoomPreviewing={isSettingsOpen && isFocusNodeTargetZoomPreviewing}
            shortcutsEnabled={
              isPersistReady && !hasBlockingShellOverlay && projectDeleteConfirmation === null
            }
            onAddWorkspace={handleAddWorkspace}
            onShowMessage={handleShowMessage}
            onRequestPersistFlush={requestPersistFlush}
            onAppendSpaceArchiveRecord={handleWorkspaceSpaceArchiveRecordAppend}
            onNodesChange={handleWorkspaceNodesChange}
            onViewportChange={handleWorkspaceViewportChange}
            onMinimapVisibilityChange={handleWorkspaceMinimapVisibilityChange}
            onSpacesChange={handleWorkspaceSpacesChange}
            onActiveSpaceChange={handleWorkspaceActiveSpaceChange}
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
        </div>

        <AppShellOverlays
          floatingMessage={floatingMessage}
          notifications={agentNotifications}
          dismissNotification={handleDismissAgentNotification}
          onFocusAgentNode={handleSelectAgentNode}
          agentSettings={agentSettings}
          setAgentSettings={setAgentSettings}
          activeWorkspace={activeWorkspace}
          isPrimarySidebarCollapsed={isPrimarySidebarCollapsed}
          isControlCenterOpen={isControlCenterOpen}
          onCloseControlCenter={closeControlCenter}
          onMinimapVisibilityChange={handleWorkspaceMinimapVisibilityChange}
          onOpenSettings={handleOpenSettings}
        />
        <AppShellPopups
          isCommandCenterOpen={isCommandCenterOpen}
          activeWorkspace={activeWorkspace}
          workspaces={workspaces}
          isPrimarySidebarCollapsed={isPrimarySidebarCollapsed}
          remoteWorkersEnabled={agentSettings.experimentalRemoteWorkersEnabled}
          onCloseCommandCenter={closeCommandCenter}
          onOpenSettings={handleOpenSettings}
          onRequestOpenEndpoints={() => {
            handleOpenSettings(
              agentSettings.experimentalRemoteWorkersEnabled ? 'endpoints' : 'experimental',
            )
          }}
          onOpenSpaceArchives={openSpaceArchives}
          onTogglePrimarySidebar={() => {
            setAgentSettings(prev => ({
              ...prev,
              isPrimarySidebarCollapsed: !prev.isPrimarySidebarCollapsed,
            }))
          }}
          onAddWorkspace={handleAddWorkspace}
          onSelectWorkspace={handleSelectWorkspace}
          onSelectSpace={handleWorkspaceActiveSpaceChange}
          isSpaceArchivesOpen={isSpaceArchivesOpen}
          canvasInputModeSetting={agentSettings.canvasInputMode}
          canvasWheelBehaviorSetting={agentSettings.canvasWheelBehavior}
          canvasWheelZoomModifierSetting={agentSettings.canvasWheelZoomModifier}
          onDeleteSpaceArchiveRecord={handleWorkspaceSpaceArchiveRecordRemove}
          onCloseSpaceArchives={closeSpaceArchives}
          isAddProjectWizardOpen={isAddProjectWizardOpen}
          onCloseAddProjectWizard={() => {
            closeAddProjectWizard()
          }}
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
            if (!projectDeleteConfirmation) {
              return
            }

            void handleRemoveWorkspace(projectDeleteConfirmation.workspaceId)
          }}
        />
        <AppShellModals
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
          onFocusNodeTargetZoomPreviewChange={setIsFocusNodeTargetZoomPreviewing}
          onChangeSettings={setAgentSettings}
          onCheckForUpdates={checkForUpdates}
          onDownloadUpdate={downloadUpdate}
          onInstallUpdate={installUpdate}
          onCloseSettings={() => {
            flushPersistNow()
            setIsFocusNodeTargetZoomPreviewing(false)
            setSettingsInitialPageId(null)
            setSettingsOpenPageId(null)
            setIsSettingsOpen(false)
          }}
          whatsNew={whatsNew}
        />
        <WorkspaceDirectoryPickerBridge />
      </>
    </AppShellBootBoundary>
  )
}
