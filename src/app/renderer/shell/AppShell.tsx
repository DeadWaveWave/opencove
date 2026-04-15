import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL, resolveAgentModel } from '@contexts/settings/domain/agentSettings'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence'
import { AppHeader } from './components/AppHeader'
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
import { usePersistedAppState } from './hooks/usePersistedAppState'
import { usePtySessionBindingsSync } from './hooks/usePtySessionBindingsSync'
import { usePtyWorkspaceRuntimeSync } from './hooks/usePtyWorkspaceRuntimeSync'
import { useProjectContextMenuDismiss } from './hooks/useProjectContextMenuDismiss'
import { useProviderModelCatalog } from './hooks/useProviderModelCatalog'
import { useAppKeybindings } from './hooks/useAppKeybindings'
import { useAgentStandbyNotifications } from './hooks/useAgentStandbyNotifications'
import { useFloatingMessage } from './hooks/useFloatingMessage'
import { useWorkspaceStateHandlers } from './hooks/useWorkspaceStateHandlers'
import { useAppUpdates } from './hooks/useAppUpdates'
import { useAppShellWorkspaceActions } from './hooks/useAppShellWorkspaceActions'
import { useWhatsNew } from './hooks/useWhatsNew'
import { useWorkerSyncStateUpdates } from './hooks/useWorkerSyncStateUpdates'
import { useWorkspaceMountRepair } from './hooks/useWorkspaceMountRepair'
import { useWebsiteWindowEvents } from './hooks/useWebsiteWindowEvents'
import { useWebsiteWindowOcclusionSync } from './hooks/useWebsiteWindowOcclusionSync'
import { useWebsiteWindowPolicySync } from './hooks/useWebsiteWindowPolicySync'
import { useAppStore } from './store/useAppStore'
import { formatKeyChord, resolveCommandKeybinding } from '@contexts/settings/domain/keybindings'
import type { SettingsPageId } from '@contexts/settings/presentation/renderer/SettingsPanel.shared'

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

  usePtySessionBindingsSync()
  usePtyWorkspaceRuntimeSync({ requestPersistFlush })
  useWorkerSyncStateUpdates({ enabled: isPersistReady })
  useWorkspaceMountRepair({ enabled: isPersistReady, workspaces, requestPersistFlush })
  useWebsiteWindowEvents()
  useWebsiteWindowPolicySync(agentSettings.websiteWindowPolicy)

  const activeWorkspace = useMemo(
    () => workspaces.find(workspace => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  )

  const activeWorkspaceName = activeWorkspace?.name ?? null

  const isPrimarySidebarCollapsed = agentSettings.isPrimarySidebarCollapsed === true

  const [isCommandCenterOpen, setIsCommandCenterOpen] = useState(false)
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false)
  const [isWorkspaceSearchOpen, setIsWorkspaceSearchOpen] = useState(false)
  const [isSpaceArchivesOpen, setIsSpaceArchivesOpen] = useState(false)
  const [isAddProjectWizardOpen, setIsAddProjectWizardOpen] = useState(false)
  const [isFocusNodeTargetZoomPreviewing, setIsFocusNodeTargetZoomPreviewing] = useState(false)
  const [settingsInitialPageId, setSettingsInitialPageId] = useState<SettingsPageId | null>(null)

  useWebsiteWindowOcclusionSync(
    isSettingsOpen ||
      isCommandCenterOpen ||
      isControlCenterOpen ||
      isWorkspaceSearchOpen ||
      isSpaceArchivesOpen ||
      isAddProjectWizardOpen ||
      projectMountManager !== null ||
      projectDeleteConfirmation !== null,
  )

  const toggleCommandCenter = useCallback((): void => {
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsCommandCenterOpen(open => !open)
  }, [])

  const closeCommandCenter = useCallback((): void => {
    setIsCommandCenterOpen(false)
  }, [])

  const toggleControlCenter = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsControlCenterOpen(open => !open)
  }, [])

  const closeControlCenter = useCallback((): void => {
    setIsControlCenterOpen(false)
  }, [])

  const openWorkspaceSearch = useCallback((): void => {
    closeCommandCenter()
    setIsControlCenterOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsWorkspaceSearchOpen(true)
  }, [closeCommandCenter])

  const closeWorkspaceSearch = useCallback((): void => {
    setIsWorkspaceSearchOpen(false)
  }, [])

  const openSpaceArchives = useCallback((): void => {
    closeCommandCenter()
    closeWorkspaceSearch()
    closeControlCenter()
    setIsSpaceArchivesOpen(true)
  }, [closeCommandCenter, closeControlCenter, closeWorkspaceSearch])

  const closeSpaceArchives = useCallback((): void => {
    setIsSpaceArchivesOpen(false)
  }, [])

  useAppKeybindings({
    enabled: !isSettingsOpen && projectDeleteConfirmation === null,
    settings: {
      disableAppShortcutsWhenTerminalFocused: agentSettings.disableAppShortcutsWhenTerminalFocused,
      keybindings: agentSettings.keybindings,
    },
    onToggleCommandCenter: toggleCommandCenter,
    onOpenSettings: () => {
      closeCommandCenter()
      closeWorkspaceSearch()
      closeControlCenter()
      closeSpaceArchives()
      setSettingsInitialPageId(null)
      setSettingsOpenPageId(null)
      setIsSettingsOpen(true)
    },
    onTogglePrimarySidebar: () => {
      closeCommandCenter()
      closeWorkspaceSearch()
      closeControlCenter()
      closeSpaceArchives()
      setAgentSettings(prev => ({
        ...prev,
        isPrimarySidebarCollapsed: !prev.isPrimarySidebarCollapsed,
      }))
    },
    onAddProject: () => {
      closeCommandCenter()
      closeWorkspaceSearch()
      closeControlCenter()
      closeSpaceArchives()
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

    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsSpaceArchivesOpen(false)
  }, [isSettingsOpen, projectDeleteConfirmation])

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
    closeCommandCenter()
    closeControlCenter()
    setIsWorkspaceSearchOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsAddProjectWizardOpen(true)
  }, [closeCommandCenter, closeControlCenter])

  const {
    handleWorkspaceNodesChange,
    handleWorkspaceViewportChange,
    handleWorkspaceMinimapVisibilityChange,
    handleWorkspaceSpacesChange,
    handleWorkspaceActiveSpaceChange,
    handleWorkspaceSpaceArchiveRecordAppend,
    handleWorkspaceSpaceArchiveRecordRemove,
    handleAnyWorkspaceWorktreesRootChange,
  } = useWorkspaceStateHandlers({ requestPersistFlush })

  const {
    handleRemoveWorkspace,
    handleSelectWorkspace,
    handleSelectAgentNode,
    handleRequestRemoveProject,
    handleRequestManageProjectMounts,
    handleReorderWorkspaces,
  } = useAppShellWorkspaceActions({ requestPersistFlush })

  useProjectContextMenuDismiss({
    projectContextMenu,
    setProjectContextMenu,
  })

  const handleOpenSettings = useCallback(
    (initialPageId: SettingsPageId | null = null): void => {
      setIsFocusNodeTargetZoomPreviewing(false)
      setSettingsInitialPageId(initialPageId)
      closeControlCenter()
      setSettingsOpenPageId(null)
      setIsSettingsOpen(true)
    },
    [closeControlCenter, setIsSettingsOpen, setSettingsOpenPageId],
  )

  return (
    <>
      <div
        className={`app-shell ${isPrimarySidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}`}
      >
        <AppHeader
          activeWorkspaceName={activeWorkspace?.name ?? null}
          activeWorkspacePath={null}
          isSidebarCollapsed={isPrimarySidebarCollapsed}
          isControlCenterOpen={isControlCenterOpen}
          isCommandCenterOpen={isCommandCenterOpen}
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
            !isSettingsOpen &&
            !isCommandCenterOpen &&
            !isControlCenterOpen &&
            !isWorkspaceSearchOpen &&
            !isSpaceArchivesOpen &&
            projectDeleteConfirmation === null
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
          setIsAddProjectWizardOpen(false)
        }}
        projectContextMenu={projectContextMenu}
        projectMountManager={projectMountManager}
        onCloseProjectMountManager={() => {
          setProjectMountManager(null)
        }}
        onRequestManageProjectMounts={handleRequestManageProjectMounts}
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
  )
}
