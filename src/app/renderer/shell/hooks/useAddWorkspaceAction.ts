import { useCallback } from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { DEFAULT_WORKSPACE_MINIMAP_VISIBLE } from '@contexts/workspace/presentation/renderer/types'
import { createDefaultWorkspaceViewport } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import { useAppStore } from '../store/useAppStore'

export function useAddWorkspaceAction(): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
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
      spaceArchiveRecords: [],
    }

    store.setWorkspaces(prev => [...prev, nextWorkspace])
    store.setActiveWorkspaceId(nextWorkspace.id)
    store.setFocusRequest(null)
  }, [])
}
