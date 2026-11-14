import { useCallback } from 'react'
import {
  appendWorkspaceSpaceArchiveRecord,
  removeWorkspaceSpaceArchiveRecord,
  setWorkspaceActiveSpace,
  setWorkspaceMinimapVisible,
  setWorkspaceViewport,
} from '@contexts/workspace/presentation/renderer'
import type {
  SpaceArchiveRecord,
  WorkspaceViewport,
} from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import { recordUiGeometryBreadcrumb } from '@contexts/issueReport/presentation/renderer/uiGeometryDiagnostics'

// Handlers that act for "the workspace the user is looking at" read it when they run.
export function useWorkspaceStateHandlers({
  requestPersistFlush,
}: {
  requestPersistFlush: () => void
}): {
  handleWorkspaceViewportChange: (viewport: WorkspaceViewport) => void
  handleWorkspaceMinimapVisibilityChange: (isVisible: boolean) => void
  handleWorkspaceActiveSpaceChange: (spaceId: string | null) => void
  handleWorkspaceSpaceArchiveRecordAppend: (record: SpaceArchiveRecord) => void
  handleWorkspaceSpaceArchiveRecordRemove: (recordId: string) => void
  handleAnyWorkspaceWorktreesRootChange: (workspaceId: string, worktreesRoot: string) => void
  handleAnyWorkspaceEnvironmentVariablesChange: (
    workspaceId: string,
    environmentVariables: Record<string, string>,
  ) => void
} {
  const handleWorkspaceViewportChange = useCallback((viewport: WorkspaceViewport): void => {
    recordUiGeometryBreadcrumb('canvas-viewport-change', {
      x: viewport.x,
      y: viewport.y,
      zoom: viewport.zoom,
    })
    const { activeWorkspaceId } = useAppStore.getState()
    if (activeWorkspaceId) {
      setWorkspaceViewport(activeWorkspaceId, viewport)
    }
  }, [])

  const handleWorkspaceMinimapVisibilityChange = useCallback((isVisible: boolean): void => {
    const { activeWorkspaceId } = useAppStore.getState()
    if (activeWorkspaceId) {
      setWorkspaceMinimapVisible(activeWorkspaceId, isVisible)
    }
  }, [])

  const handleWorkspaceActiveSpaceChange = useCallback((spaceId: string | null): void => {
    const { activeWorkspaceId } = useAppStore.getState()
    if (activeWorkspaceId) {
      setWorkspaceActiveSpace(activeWorkspaceId, spaceId)
    }
  }, [])

  const handleWorkspaceSpaceArchiveRecordAppend = useCallback(
    (record: SpaceArchiveRecord): void => {
      const { activeWorkspaceId } = useAppStore.getState()
      if (activeWorkspaceId) {
        appendWorkspaceSpaceArchiveRecord(activeWorkspaceId, record)
      }
    },
    [],
  )

  const handleWorkspaceSpaceArchiveRecordRemove = useCallback((recordId: string): void => {
    const { activeWorkspaceId } = useAppStore.getState()
    if (activeWorkspaceId) {
      removeWorkspaceSpaceArchiveRecord(activeWorkspaceId, recordId)
    }
  }, [])

  const handleAnyWorkspaceWorktreesRootChange = useCallback(
    (workspaceId: string, worktreesRoot: string): void => {
      useAppStore.getState().setWorkspaceWorktreesRoot(workspaceId, worktreesRoot)
      requestPersistFlush()
    },
    [requestPersistFlush],
  )

  const handleAnyWorkspaceEnvironmentVariablesChange = useCallback(
    (workspaceId: string, environmentVariables: Record<string, string>): void => {
      useAppStore.getState().setWorkspaceEnvironmentVariables(workspaceId, environmentVariables)
      requestPersistFlush()
    },
    [requestPersistFlush],
  )

  return {
    handleWorkspaceViewportChange,
    handleWorkspaceMinimapVisibilityChange,
    handleWorkspaceActiveSpaceChange,
    handleWorkspaceSpaceArchiveRecordAppend,
    handleWorkspaceSpaceArchiveRecordRemove,
    handleAnyWorkspaceWorktreesRootChange,
    handleAnyWorkspaceEnvironmentVariablesChange,
  }
}
