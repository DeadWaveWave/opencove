import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { isWorkspacePageId, type SettingsPageId } from './SettingsPanel.shared'

export function useSettingsPanelPageState(options: {
  openPageId?: SettingsPageId | null
  workspaces: WorkspaceState[]
  contentRef: RefObject<HTMLDivElement | null>
  onFocusNodeTargetZoomPreviewChange: (isPreviewing: boolean) => void
}): {
  activePageId: SettingsPageId
  setActivePageId: (pageId: SettingsPageId) => void
  activeWorkspace: WorkspaceState | null
} {
  const { openPageId, workspaces, contentRef, onFocusNodeTargetZoomPreviewChange } = options
  const [activePageId, setActivePageId] = useState<SettingsPageId>(() => openPageId ?? 'general')

  const activeWorkspace = useMemo(() => {
    if (!isWorkspacePageId(activePageId)) {
      return null
    }

    const workspaceId = activePageId.slice('workspace:'.length)
    return workspaces.find(workspace => workspace.id === workspaceId) ?? null
  }, [activePageId, workspaces])

  useEffect(() => {
    if (isWorkspacePageId(activePageId) && !activeWorkspace) {
      setActivePageId('general')
    }
  }, [activePageId, activeWorkspace])

  useEffect(() => {
    if (!openPageId) {
      return
    }

    setActivePageId(openPageId)
  }, [openPageId])

  useEffect(() => {
    if (!contentRef.current) {
      return
    }

    contentRef.current.scrollTop = 0
  }, [activePageId, contentRef])

  useEffect(() => {
    if (activePageId !== 'canvas') {
      onFocusNodeTargetZoomPreviewChange(false)
    }
  }, [activePageId, onFocusNodeTargetZoomPreviewChange])

  return {
    activePageId,
    setActivePageId: nextPageId => setActivePageId(nextPageId),
    activeWorkspace,
  }
}
