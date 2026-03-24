import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsPanel } from '@contexts/settings/presentation/renderer/SettingsPanel'
import { AGENT_PROVIDER_LABEL, resolveAgentModel } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceCanvasMessageTone } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { DEFAULT_WORKSPACE_MINIMAP_VISIBLE } from '@contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence'
import { AppMessage } from './components/AppMessage'
import { AppHeader } from './components/AppHeader'
import { CommandCenter } from './components/CommandCenter'
import { DeleteProjectDialog } from './components/DeleteProjectDialog'
import { ProjectContextMenu } from './components/ProjectContextMenu'
import { Sidebar } from './components/Sidebar'
import { WorkspaceMain } from './components/WorkspaceMain'
import { WorkspaceSearchOverlay } from './components/WorkspaceSearchOverlay'
import { useHydrateAppState } from './hooks/useHydrateAppState'
import { useApplyUiFontScale } from './hooks/useApplyUiFontScale'
import { useApplyUiTheme } from './hooks/useApplyUiTheme'
import { useApplyUiLanguage } from './hooks/useApplyUiLanguage'
import { usePersistedAppState } from './hooks/usePersistedAppState'
import { usePtyWorkspaceRuntimeSync } from './hooks/usePtyWorkspaceRuntimeSync'
import { useProjectContextMenuDismiss } from './hooks/useProjectContextMenuDismiss'
import { useProviderModelCatalog } from './hooks/useProviderModelCatalog'
import { useAppKeybindings } from './hooks/useAppKeybindings'
import { useWorkspaceStateHandlers } from './hooks/useWorkspaceStateHandlers'
import { useAppUpdates } from './hooks/useAppUpdates'
import { useWhatsNew } from './hooks/useWhatsNew'
import type { ProjectContextMenuState } from './types'
import { useAppStore } from './store/useAppStore'
import { createDefaultWorkspaceViewport } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import { removeWorkspace } from './utils/removeWorkspace'
import { WhatsNewDialog } from './components/WhatsNewDialog'
import { formatKeyChord, resolveCommandKeybinding } from '@contexts/settings/domain/keybindings'

export default function App(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    workspaces,
    activeWorkspaceId,
    projectContextMenu,
    projectDeleteConfirmation,
    isRemovingProject,
    agentSettings,
    isSettingsOpen,
    focusRequest,
    setWorkspaces,
    setActiveWorkspaceId,
    setProjectContextMenu,
    setProjectDeleteConfirmation,
    setAgentSettings,
    setIsSettingsOpen,
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

  usePtyWorkspaceRuntimeSync({ requestPersistFlush })

  const activeWorkspace = useMemo(
    () => workspaces.find(workspace => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  )

  const activeWorkspaceName = activeWorkspace?.name ?? null

  const isPrimarySidebarCollapsed = agentSettings.isPrimarySidebarCollapsed === true

  const [isCommandCenterOpen, setIsCommandCenterOpen] = useState(false)
  const [isWorkspaceSearchOpen, setIsWorkspaceSearchOpen] = useState(false)
  const [isFocusNodeTargetZoomPreviewing, setIsFocusNodeTargetZoomPreviewing] = useState(false)

  const toggleCommandCenter = useCallback((): void => {
    setIsWorkspaceSearchOpen(false)
    setIsCommandCenterOpen(open => !open)
  }, [])

  const closeCommandCenter = useCallback((): void => {
    setIsCommandCenterOpen(false)
  }, [])

  const openWorkspaceSearch = useCallback((): void => {
    closeCommandCenter()
    setIsWorkspaceSearchOpen(true)
  }, [closeCommandCenter])

  const closeWorkspaceSearch = useCallback((): void => {
    setIsWorkspaceSearchOpen(false)
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
      setIsSettingsOpen(true)
    },
    onTogglePrimarySidebar: () => {
      closeCommandCenter()
      closeWorkspaceSearch()
      setAgentSettings(prev => ({
        ...prev,
        isPrimarySidebarCollapsed: !prev.isPrimarySidebarCollapsed,
      }))
    },
    onAddProject: () => {
      closeCommandCenter()
      closeWorkspaceSearch()
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

  const [floatingMessage, setFloatingMessage] = useState<{
    id: number
    text: string
    tone: WorkspaceCanvasMessageTone
  } | null>(null)

  useEffect(() => {
    if (!floatingMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setFloatingMessage(current => (current?.id === floatingMessage.id ? null : current))
    }, 3200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [floatingMessage])

  const handleShowMessage = useCallback(
    (message: string, tone: WorkspaceCanvasMessageTone = 'info'): void => {
      setFloatingMessage({ id: Date.now(), text: message, tone })
    },
    [],
  )

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
  const handleAddWorkspace = useCallback(async (): Promise<void> => {
    const selected = await window.opencoveApi.workspace.selectDirectory()
    if (!selected) {
      return
    }

    const store = useAppStore.getState()
    const existing = store.workspaces.find(workspace => workspace.path === selected.path)
    if (existing) {
      store.setActiveWorkspaceId(existing.id)
      return
    }

    const nextWorkspace: WorkspaceState = {
      ...selected,
      nodes: [],
      worktreesRoot: '',
      viewport: createDefaultWorkspaceViewport(),
      isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
      spaces: [],
      activeSpaceId: null,
    }

    store.setWorkspaces(prev => [...prev, nextWorkspace])
    store.setActiveWorkspaceId(nextWorkspace.id)
    store.setFocusRequest(null)
  }, [])

  const {
    handleWorkspaceNodesChange,
    handleWorkspaceViewportChange,
    handleWorkspaceMinimapVisibilityChange,
    handleWorkspaceSpacesChange,
    handleWorkspaceActiveSpaceChange,
    handleAnyWorkspaceWorktreesRootChange,
  } = useWorkspaceStateHandlers({ requestPersistFlush })

  const handleRemoveWorkspace = useCallback(async (workspaceId: string): Promise<void> => {
    await removeWorkspace(workspaceId)
  }, [])

  useProjectContextMenuDismiss({
    projectContextMenu,
    setProjectContextMenu,
  })
  const handleSelectWorkspace = useCallback((workspaceId: string): void => {
    const store = useAppStore.getState()
    store.setActiveWorkspaceId(workspaceId)
    store.setFocusRequest(null)
  }, [])

  const handleSelectAgentNode = useCallback((workspaceId: string, nodeId: string): void => {
    const store = useAppStore.getState()
    store.setActiveWorkspaceId(workspaceId)
    store.setFocusRequest(prev => ({
      workspaceId,
      nodeId,
      sequence: (prev?.sequence ?? 0) + 1,
    }))
  }, [])

  const handleRequestRemoveProject = useCallback((workspaceId: string): void => {
    const store = useAppStore.getState()
    const targetWorkspace = store.workspaces.find(workspace => workspace.id === workspaceId)
    if (!targetWorkspace) {
      store.setProjectContextMenu(null)
      return
    }

    store.setProjectDeleteConfirmation({
      workspaceId: targetWorkspace.id,
      workspaceName: targetWorkspace.name,
    })
    store.setProjectContextMenu(null)
  }, [])

  return (
    <>
      <div
        className={`app-shell ${isPrimarySidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}`}
      >
        <AppHeader
          activeWorkspaceName={activeWorkspace?.name ?? null}
          activeWorkspacePath={activeWorkspace?.path ?? null}
          isSidebarCollapsed={isPrimarySidebarCollapsed}
          isCommandCenterOpen={isCommandCenterOpen}
          commandCenterShortcutHint={commandCenterShortcutHint}
          updateState={updateState}
          onToggleSidebar={() => {
            setAgentSettings(prev => ({
              ...prev,
              isPrimarySidebarCollapsed: !prev.isPrimarySidebarCollapsed,
            }))
          }}
          onToggleCommandCenter={() => {
            toggleCommandCenter()
          }}
          onOpenSettings={() => {
            setIsFocusNodeTargetZoomPreviewing(false)
            setIsSettingsOpen(true)
          }}
          onCheckForUpdates={() => {
            void checkForUpdates()
          }}
          onDownloadUpdate={() => {
            void downloadUpdate()
          }}
          onInstallUpdate={() => {
            void installUpdate()
          }}
        />

        {isPrimarySidebarCollapsed ? null : (
          <Sidebar
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            activeProviderLabel={activeProviderLabel}
            activeProviderModel={activeProviderModel}
            persistNotice={persistNotice}
            onAddWorkspace={() => {
              void handleAddWorkspace()
            }}
            onSelectWorkspace={workspaceId => {
              handleSelectWorkspace(workspaceId)
            }}
            onOpenProjectContextMenu={(state: ProjectContextMenuState) => {
              setProjectContextMenu(state)
            }}
            onSelectAgentNode={(workspaceId, nodeId) => {
              handleSelectAgentNode(workspaceId, nodeId)
            }}
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
            !isWorkspaceSearchOpen &&
            projectDeleteConfirmation === null
          }
          onAddWorkspace={() => {
            void handleAddWorkspace()
          }}
          onShowMessage={handleShowMessage}
          onRequestPersistFlush={requestPersistFlush}
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
          onSelectSpace={spaceId => {
            handleWorkspaceActiveSpaceChange(spaceId)
          }}
          panelWidth={agentSettings.workspaceSearchPanelWidth}
          onPanelWidthChange={nextWidth => {
            setAgentSettings(prev => ({
              ...prev,
              workspaceSearchPanelWidth: nextWidth,
            }))
          }}
        />
      </div>

      {floatingMessage ? (
        <AppMessage tone={floatingMessage.tone} text={floatingMessage.text} />
      ) : null}

      <CommandCenter
        isOpen={isCommandCenterOpen}
        activeWorkspace={activeWorkspace}
        workspaces={workspaces}
        isPrimarySidebarCollapsed={isPrimarySidebarCollapsed}
        onClose={() => {
          closeCommandCenter()
        }}
        onOpenSettings={() => {
          setIsFocusNodeTargetZoomPreviewing(false)
          setIsSettingsOpen(true)
        }}
        onTogglePrimarySidebar={() => {
          setAgentSettings(prev => ({
            ...prev,
            isPrimarySidebarCollapsed: !prev.isPrimarySidebarCollapsed,
          }))
        }}
        onAddWorkspace={() => {
          void handleAddWorkspace()
        }}
        onSelectWorkspace={workspaceId => {
          handleSelectWorkspace(workspaceId)
        }}
        onSelectSpace={spaceId => {
          handleWorkspaceActiveSpaceChange(spaceId)
        }}
      />

      {projectContextMenu ? (
        <ProjectContextMenu
          workspaceId={projectContextMenu.workspaceId}
          x={projectContextMenu.x}
          y={projectContextMenu.y}
          onRequestRemove={workspaceId => {
            handleRequestRemoveProject(workspaceId)
          }}
        />
      ) : null}

      {projectDeleteConfirmation ? (
        <DeleteProjectDialog
          workspaceName={projectDeleteConfirmation.workspaceName}
          isRemoving={isRemovingProject}
          onCancel={() => {
            setProjectDeleteConfirmation(null)
          }}
          onConfirm={() => {
            void handleRemoveWorkspace(projectDeleteConfirmation.workspaceId)
          }}
        />
      ) : null}

      {isSettingsOpen ? (
        <SettingsPanel
          settings={agentSettings}
          updateState={updateState}
          modelCatalogByProvider={providerModelCatalog}
          workspaces={workspaces}
          onWorkspaceWorktreesRootChange={(id, root) => {
            handleAnyWorkspaceWorktreesRootChange(id, root)
          }}
          isFocusNodeTargetZoomPreviewing={isFocusNodeTargetZoomPreviewing}
          onFocusNodeTargetZoomPreviewChange={setIsFocusNodeTargetZoomPreviewing}
          onChange={next => {
            setAgentSettings(next)
          }}
          onCheckForUpdates={() => {
            void checkForUpdates()
          }}
          onDownloadUpdate={() => {
            void downloadUpdate()
          }}
          onInstallUpdate={() => {
            void installUpdate()
          }}
          onClose={() => {
            flushPersistNow()
            setIsFocusNodeTargetZoomPreviewing(false)
            setIsSettingsOpen(false)
          }}
        />
      ) : null}

      <WhatsNewDialog
        isOpen={whatsNew.isOpen}
        fromVersion={whatsNew.fromVersion}
        toVersion={whatsNew.toVersion}
        notes={whatsNew.notes}
        isLoading={whatsNew.isLoading}
        error={whatsNew.error}
        compareUrl={whatsNew.compareUrl}
        onClose={() => {
          whatsNew.close()
        }}
      />
    </>
  )
}
