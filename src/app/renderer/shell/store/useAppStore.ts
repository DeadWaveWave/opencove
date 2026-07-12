import { create } from 'zustand'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { ProjectIconId } from '@shared/types/projectIcon'
import type { SettingsPageId } from '@contexts/settings/presentation/renderer/SettingsPanel.shared'
import { setRootSpacePinned } from '@contexts/workspace/domain/workspaceSpacePinning'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type {
  FocusRequest,
  PersistNotice,
  ProjectContextMenuState,
  ProjectDeleteConfirmationState,
  ProjectMountManagerState,
} from '../types'
import {
  reorderWorkspaceList,
  reorderWorkspaceRootSpaces,
  reorderWorkspaceSidebarAgents,
} from '../utils/sidebarReorder'

type SetStateAction<T> = T | ((prev: T) => T)

function applySetStateAction<T>(previous: T, action: SetStateAction<T>): T {
  return typeof action === 'function' ? (action as (prev: T) => T)(previous) : action
}

export interface AppStoreState {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  projectContextMenu: ProjectContextMenuState | null
  projectMountManager: ProjectMountManagerState | null
  projectDeleteConfirmation: ProjectDeleteConfirmationState | null
  isRemovingProject: boolean
  agentSettings: AgentSettings
  isSettingsOpen: boolean
  isProjectCreatorOpen: boolean
  settingsOpenPageId: SettingsPageId | null
  focusRequest: FocusRequest | null
  persistNotice: PersistNotice | null

  setWorkspaces: (action: SetStateAction<WorkspaceState[]>) => void
  setActiveWorkspaceId: (action: SetStateAction<string | null>) => void
  setProjectContextMenu: (action: SetStateAction<ProjectContextMenuState | null>) => void
  setProjectMountManager: (action: SetStateAction<ProjectMountManagerState | null>) => void
  setProjectDeleteConfirmation: (
    action: SetStateAction<ProjectDeleteConfirmationState | null>,
  ) => void
  setIsRemovingProject: (action: SetStateAction<boolean>) => void
  setAgentSettings: (action: SetStateAction<AgentSettings>) => void
  setIsSettingsOpen: (action: SetStateAction<boolean>) => void
  setIsProjectCreatorOpen: (action: SetStateAction<boolean>) => void
  setSettingsOpenPageId: (action: SetStateAction<SettingsPageId | null>) => void
  setFocusRequest: (action: SetStateAction<FocusRequest | null>) => void
  setPersistNotice: (action: SetStateAction<PersistNotice | null>) => void
  reorderWorkspaces: (activeId: string, overId: string) => boolean
  reorderWorkspaceRootSpaces: (
    workspaceId: string,
    activeSpaceId: string,
    overSpaceId: string,
  ) => boolean
  reorderWorkspaceSidebarAgents: (
    workspaceId: string,
    activeNodeId: string,
    overNodeId: string,
  ) => boolean
  setProjectIconId: (workspaceId: string, iconId: ProjectIconId | null) => boolean
  setWorkspaceSpacePinned: (workspaceId: string, spaceId: string, pinned: boolean) => boolean
}

export const useAppStore = create<AppStoreState>(set => ({
  workspaces: [],
  activeWorkspaceId: null,
  projectContextMenu: null,
  projectMountManager: null,
  projectDeleteConfirmation: null,
  isRemovingProject: false,
  agentSettings: DEFAULT_AGENT_SETTINGS,
  isSettingsOpen: false,
  isProjectCreatorOpen: false,
  settingsOpenPageId: null,
  focusRequest: null,
  persistNotice: null,

  setWorkspaces: action =>
    set(state => ({ workspaces: applySetStateAction(state.workspaces, action) })),
  setActiveWorkspaceId: action =>
    set(state => ({ activeWorkspaceId: applySetStateAction(state.activeWorkspaceId, action) })),
  setProjectContextMenu: action =>
    set(state => ({ projectContextMenu: applySetStateAction(state.projectContextMenu, action) })),
  setProjectMountManager: action =>
    set(state => ({ projectMountManager: applySetStateAction(state.projectMountManager, action) })),
  setProjectDeleteConfirmation: action =>
    set(state => ({
      projectDeleteConfirmation: applySetStateAction(state.projectDeleteConfirmation, action),
    })),
  setIsRemovingProject: action =>
    set(state => ({ isRemovingProject: applySetStateAction(state.isRemovingProject, action) })),
  setAgentSettings: action =>
    set(state => ({ agentSettings: applySetStateAction(state.agentSettings, action) })),
  setIsSettingsOpen: action =>
    set(state => ({ isSettingsOpen: applySetStateAction(state.isSettingsOpen, action) })),
  setIsProjectCreatorOpen: action =>
    set(state => ({
      isProjectCreatorOpen: applySetStateAction(state.isProjectCreatorOpen, action),
    })),
  setSettingsOpenPageId: action =>
    set(state => ({
      settingsOpenPageId: applySetStateAction(state.settingsOpenPageId, action),
    })),
  setFocusRequest: action =>
    set(state => ({ focusRequest: applySetStateAction(state.focusRequest, action) })),
  setPersistNotice: action =>
    set(state => ({ persistNotice: applySetStateAction(state.persistNotice, action) })),
  reorderWorkspaces: (activeId, overId) => {
    let changed = false
    set(state => {
      const workspaces = reorderWorkspaceList(state.workspaces, activeId, overId)
      changed = workspaces !== state.workspaces
      return changed ? { workspaces } : state
    })
    return changed
  },
  reorderWorkspaceRootSpaces: (workspaceId, activeSpaceId, overSpaceId) => {
    let changed = false
    set(state => {
      const workspaces = reorderWorkspaceRootSpaces(
        state.workspaces,
        workspaceId,
        activeSpaceId,
        overSpaceId,
      )
      changed = workspaces !== state.workspaces
      return changed ? { workspaces } : state
    })
    return changed
  },
  reorderWorkspaceSidebarAgents: (workspaceId, activeNodeId, overNodeId) => {
    let changed = false
    set(state => {
      const workspaces = reorderWorkspaceSidebarAgents(
        state.workspaces,
        workspaceId,
        activeNodeId,
        overNodeId,
      )
      changed = workspaces !== state.workspaces
      return changed ? { workspaces } : state
    })
    return changed
  },
  setProjectIconId: (workspaceId, iconId) => {
    let changed = false
    set(state => {
      const workspaces = state.workspaces.map(workspace => {
        if (workspace.id !== workspaceId || (workspace.iconId ?? null) === iconId) {
          return workspace
        }

        changed = true
        return {
          ...workspace,
          iconId,
        }
      })

      return changed ? { workspaces } : state
    })
    return changed
  },
  setWorkspaceSpacePinned: (workspaceId, spaceId, pinned) => {
    let changed = false
    set(state => {
      const workspaces = state.workspaces.map(workspace => {
        if (workspace.id !== workspaceId) {
          return workspace
        }

        const spaces = setRootSpacePinned(workspace.spaces, spaceId, pinned)
        if (spaces === workspace.spaces) {
          return workspace
        }

        changed = true
        return { ...workspace, spaces }
      })

      return changed ? { workspaces } : state
    })
    return changed
  },
}))
