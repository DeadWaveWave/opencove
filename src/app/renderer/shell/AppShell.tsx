import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsPanel } from '@contexts/settings/presentation/renderer/SettingsPanel'
import { AGENT_PROVIDER_LABEL, resolveAgentModel } from '@contexts/settings/domain/agentSettings'
import { WorkspaceCanvas } from '@contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
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
import { WorkspaceEmptyState } from './components/WorkspaceEmptyState'
import { useHydrateAppState } from './hooks/useHydrateAppState'
import { useApplyUiFontScale } from './hooks/useApplyUiFontScale'
import { useApplyUiTheme } from './hooks/useApplyUiTheme'
import { useApplyUiLanguage } from './hooks/useApplyUiLanguage'
import { usePersistedAppState } from './hooks/usePersistedAppState'
import { usePtyWorkspaceRuntimeSync } from './hooks/usePtyWorkspaceRuntimeSync'
import { useProjectContextMenuDismiss } from './hooks/useProjectContextMenuDismiss'
import { useProviderModelCatalog } from './hooks/useProviderModelCatalog'
import { useCommandCenterShortcuts } from './hooks/useCommandCenterShortcuts'
import { useWorkspaceStateHandlers } from './hooks/useWorkspaceStateHandlers'
import type { ProjectContextMenuState } from './types'
import { useAppStore } from './store/useAppStore'
import { createDefaultWorkspaceViewport } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import { removeWorkspace } from './utils/removeWorkspace'

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

  const toggleCommandCenter = useCallback((): void => {
    setIsCommandCenterOpen(open => !open)
  }, [])

  const closeCommandCenter = useCallback((): void => {
    setIsCommandCenterOpen(false)
  }, [])

  useCommandCenterShortcuts({
    enabled: !isSettingsOpen && projectDeleteConfirmation === null,
    onToggle: toggleCommandCenter,
  })

  useEffect(() => {
    if (!isSettingsOpen && projectDeleteConfirmation === null) {
      return
    }

    setIsCommandCenterOpen(false)
  }, [isSettingsOpen, projectDeleteConfirmation])

  useEffect(() => {
    document.title = activeWorkspaceName ? `${activeWorkspaceName} — OpenCove` : 'OpenCove'
  }, [activeWorkspaceName])

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
            setIsSettingsOpen(true)
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

        <main className="workspace-main">
          {activeWorkspace ? (
            <WorkspaceCanvas
              workspaceId={activeWorkspace.id}
              onShowMessage={handleShowMessage}
              workspacePath={activeWorkspace.path}
              worktreesRoot={activeWorkspace.worktreesRoot}
              nodes={activeWorkspace.nodes}
              onNodesChange={handleWorkspaceNodesChange}
              onRequestPersistFlush={requestPersistFlush}
              viewport={activeWorkspace.viewport}
              isMinimapVisible={activeWorkspace.isMinimapVisible}
              onViewportChange={handleWorkspaceViewportChange}
              onMinimapVisibilityChange={handleWorkspaceMinimapVisibilityChange}
              spaces={activeWorkspace.spaces}
              activeSpaceId={activeWorkspace.activeSpaceId}
              onSpacesChange={handleWorkspaceSpacesChange}
              onActiveSpaceChange={handleWorkspaceActiveSpaceChange}
              agentSettings={agentSettings}
              focusNodeId={
                focusRequest && focusRequest.workspaceId === activeWorkspace.id
                  ? focusRequest.nodeId
                  : null
              }
              focusSequence={
                focusRequest && focusRequest.workspaceId === activeWorkspace.id
                  ? focusRequest.sequence
                  : 0
              }
            />
          ) : (
            <WorkspaceEmptyState onAddWorkspace={() => void handleAddWorkspace()} />
          )}
        </main>
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
          modelCatalogByProvider={providerModelCatalog}
          workspaces={workspaces}
          onWorkspaceWorktreesRootChange={(id, root) => {
            handleAnyWorkspaceWorktreesRootChange(id, root)
          }}
          onChange={next => {
            setAgentSettings(next)
          }}
          onClose={() => {
            flushPersistNow()
            setIsSettingsOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
