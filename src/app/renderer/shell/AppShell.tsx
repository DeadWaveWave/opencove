import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsPanel } from '@contexts/settings/presentation/renderer/SettingsPanel'
import { AGENT_PROVIDER_LABEL, resolveAgentModel } from '@contexts/settings/domain/agentSettings'
import { WorkspaceCanvas } from '@contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import type { WorkspaceCanvasMessageTone } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type {
  WorkspaceViewport,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { DEFAULT_WORKSPACE_MINIMAP_VISIBLE } from '@contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence'
import { AppMessage } from './components/AppMessage'
import { DeleteProjectDialog } from './components/DeleteProjectDialog'
import { ProjectContextMenu } from './components/ProjectContextMenu'
import { Sidebar } from './components/Sidebar'
import { WorkspaceEmptyState } from './components/WorkspaceEmptyState'
import { useHydrateAppState } from './hooks/useHydrateAppState'
import { usePersistedAppState } from './hooks/usePersistedAppState'
import { usePtyWorkspaceRuntimeSync } from './hooks/usePtyWorkspaceRuntimeSync'
import { useProjectContextMenuDismiss } from './hooks/useProjectContextMenuDismiss'
import { useProviderModelCatalog } from './hooks/useProviderModelCatalog'
import type { ProjectContextMenuState } from './types'
import { useAppStore } from './store/useAppStore'
import {
  createDefaultWorkspaceViewport,
  sanitizeWorkspaceSpaces,
} from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import { cleanupNodeRuntimeArtifacts } from '@contexts/workspace/presentation/renderer/utils/nodeRuntimeCleanup'
import { applyUiLanguage } from '../i18n'

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
  useEffect(() => {
    const root = document.documentElement
    const uiFontScale = (agentSettings.uiFontSize / 16).toFixed(2)
    root.style.setProperty('--cove-ui-font-scale', uiFontScale)
  }, [agentSettings.uiFontSize])

  useEffect(() => {
    document.documentElement.lang = agentSettings.language
    void applyUiLanguage(agentSettings.language)
  }, [agentSettings.language])

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

  const handleWorkspaceNodesChange = useCallback((nodes: WorkspaceState['nodes']): void => {
    const { activeWorkspaceId, setWorkspaces } = useAppStore.getState()
    if (!activeWorkspaceId) {
      return
    }

    setWorkspaces(prev =>
      prev.map(workspace => {
        if (workspace.id !== activeWorkspaceId) {
          return workspace
        }

        const nodeIds = new Set(nodes.map(node => node.id))
        const nextSpaces = sanitizeWorkspaceSpaces(
          workspace.spaces.map(space => ({
            ...space,
            nodeIds: space.nodeIds.filter(nodeId => nodeIds.has(nodeId)),
          })),
        )
        const hasActiveSpace =
          workspace.activeSpaceId !== null &&
          nextSpaces.some(space => space.id === workspace.activeSpaceId)

        return {
          ...workspace,
          nodes,
          spaces: nextSpaces,
          activeSpaceId: hasActiveSpace ? workspace.activeSpaceId : null,
        }
      }),
    )
  }, [])

  const handleWorkspaceViewportChange = useCallback((viewport: WorkspaceViewport): void => {
    const { activeWorkspaceId, setWorkspaces } = useAppStore.getState()
    if (!activeWorkspaceId) {
      return
    }

    setWorkspaces(previous =>
      previous.map(workspace => {
        if (workspace.id !== activeWorkspaceId) {
          return workspace
        }

        if (
          workspace.viewport.x === viewport.x &&
          workspace.viewport.y === viewport.y &&
          workspace.viewport.zoom === viewport.zoom
        ) {
          return workspace
        }

        return {
          ...workspace,
          viewport: {
            x: viewport.x,
            y: viewport.y,
            zoom: viewport.zoom,
          },
        }
      }),
    )
  }, [])

  const handleWorkspaceMinimapVisibilityChange = useCallback((isVisible: boolean): void => {
    const { activeWorkspaceId, setWorkspaces } = useAppStore.getState()
    if (!activeWorkspaceId) {
      return
    }

    setWorkspaces(previous =>
      previous.map(workspace => {
        if (workspace.id !== activeWorkspaceId) {
          return workspace
        }

        if (workspace.isMinimapVisible === isVisible) {
          return workspace
        }

        return {
          ...workspace,
          isMinimapVisible: isVisible,
        }
      }),
    )
  }, [])

  const handleWorkspaceSpacesChange = useCallback((spaces: WorkspaceState['spaces']): void => {
    const { activeWorkspaceId, setWorkspaces } = useAppStore.getState()
    if (!activeWorkspaceId) {
      return
    }

    setWorkspaces(previous =>
      previous.map(workspace => {
        if (workspace.id !== activeWorkspaceId) {
          return workspace
        }

        const sanitizedSpaces = sanitizeWorkspaceSpaces(spaces)
        const hasActiveSpace =
          workspace.activeSpaceId !== null &&
          sanitizedSpaces.some(space => space.id === workspace.activeSpaceId)

        return {
          ...workspace,
          spaces: sanitizedSpaces,
          activeSpaceId: hasActiveSpace ? workspace.activeSpaceId : null,
        }
      }),
    )
  }, [])

  const handleWorkspaceActiveSpaceChange = useCallback((spaceId: string | null): void => {
    const { activeWorkspaceId, setWorkspaces } = useAppStore.getState()
    if (!activeWorkspaceId) {
      return
    }

    setWorkspaces(previous =>
      previous.map(workspace => {
        if (workspace.id !== activeWorkspaceId) {
          return workspace
        }

        const hasTargetSpace =
          spaceId !== null && workspace.spaces.some(space => space.id === spaceId)
        const nextSpaceId = hasTargetSpace ? spaceId : null
        if (workspace.activeSpaceId === nextSpaceId) {
          return workspace
        }

        return {
          ...workspace,
          activeSpaceId: nextSpaceId,
        }
      }),
    )
  }, [])

  const handleAnyWorkspaceWorktreesRootChange = useCallback(
    (workspaceId: string, worktreesRoot: string): void => {
      const { setWorkspaces } = useAppStore.getState()
      setWorkspaces(previous =>
        previous.map(workspace => {
          if (workspace.id !== workspaceId) {
            return workspace
          }
          if (workspace.worktreesRoot === worktreesRoot) {
            return workspace
          }
          return {
            ...workspace,
            worktreesRoot,
          }
        }),
      )
      requestPersistFlush()
    },
    [requestPersistFlush],
  )

  const handleRemoveWorkspace = useCallback(async (workspaceId: string): Promise<void> => {
    useAppStore.getState().setIsRemovingProject(true)

    const targetWorkspace = useAppStore
      .getState()
      .workspaces.find(workspace => workspace.id === workspaceId)
    if (!targetWorkspace) {
      useAppStore.getState().setProjectDeleteConfirmation(null)
      useAppStore.getState().setIsRemovingProject(false)
      return
    }

    try {
      targetWorkspace.nodes.forEach(node => {
        cleanupNodeRuntimeArtifacts(node.id, node.data.sessionId)
      })

      await Promise.allSettled(
        targetWorkspace.nodes
          .map(node => node.data.sessionId)
          .filter(sessionId => sessionId.length > 0)
          .map(sessionId => window.opencoveApi.pty.kill({ sessionId })),
      )

      const nextWorkspaces = useAppStore
        .getState()
        .workspaces.filter(workspace => workspace.id !== workspaceId)
      useAppStore.getState().setWorkspaces(nextWorkspaces)
      useAppStore
        .getState()
        .setActiveWorkspaceId(currentActiveId =>
          currentActiveId === workspaceId ? (nextWorkspaces[0]?.id ?? null) : currentActiveId,
        )
      useAppStore.getState().setFocusRequest(null)
      useAppStore.getState().setProjectDeleteConfirmation(null)
    } finally {
      useAppStore.getState().setIsRemovingProject(false)
    }
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
      <div className="app-shell">
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
          onOpenSettings={() => {
            setIsSettingsOpen(true)
          }}
        />

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
