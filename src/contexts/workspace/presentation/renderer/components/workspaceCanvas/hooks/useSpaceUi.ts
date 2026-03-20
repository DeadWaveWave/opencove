import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { WorkspacePathOpener, WorkspacePathOpenerId } from '@shared/contracts/dto'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type {
  ContextMenuState,
  EmptySelectionPromptState,
  SpaceWorktreeDialogState,
} from '../types'

export function useWorkspaceCanvasSpaceUi({
  contextMenu,
  setContextMenu,
  setEmptySelectionPrompt,
  cancelSpaceRename,
  workspacePath,
  spacesRef,
  handlePaneClick,
  handlePaneContextMenu,
  handleNodeContextMenu,
  handleSelectionContextMenu,
}: {
  contextMenu: ContextMenuState | null
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
  cancelSpaceRename: () => void
  workspacePath: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  handlePaneClick: (event: React.MouseEvent | MouseEvent) => void
  handlePaneContextMenu: (event: React.MouseEvent | MouseEvent) => void
  handleNodeContextMenu: (event: React.MouseEvent, node: Node<TerminalNodeData>) => void
  handleSelectionContextMenu: (
    event: React.MouseEvent,
    selectedNodes: Node<TerminalNodeData>[],
  ) => void
}): {
  spaceActionMenu: { spaceId: string; x: number; y: number } | null
  spaceWorktreeDialog: SpaceWorktreeDialogState | null
  availablePathOpeners: WorkspacePathOpener[]
  handleCanvasClick: () => void
  closeContextMenu: () => void
  handlePaneClickWithSpaceMenuClose: (event: React.MouseEvent | MouseEvent) => void
  handlePaneContextMenuWithSpaceMenuClose: (event: React.MouseEvent | MouseEvent) => void
  handleNodeContextMenuWithSpaceMenuClose: (
    event: React.MouseEvent,
    node: Node<TerminalNodeData>,
  ) => void
  handleSelectionContextMenuWithSpaceMenuClose: (
    event: React.MouseEvent,
    selectedNodes: Node<TerminalNodeData>[],
  ) => void
  openSpaceActionMenu: (spaceId: string, anchor: { x: number; y: number }) => void
  closeSpaceActionMenu: () => void
  copySpacePath: (spaceId: string) => Promise<void>
  openSpacePath: (spaceId: string, openerId: WorkspacePathOpenerId) => Promise<void>
  openSpaceCreateWorktree: (spaceId: string) => void
  openSpaceArchive: (spaceId: string) => void
  closeSpaceWorktree: () => void
} {
  const [spaceActionMenu, setSpaceActionMenu] = useState<{
    spaceId: string
    x: number
    y: number
  } | null>(null)
  const [spaceWorktreeDialog, setSpaceWorktreeDialog] = useState<SpaceWorktreeDialogState | null>(
    null,
  )
  const [availablePathOpeners, setAvailablePathOpeners] = useState<WorkspacePathOpener[]>([])

  useEffect(() => {
    if (contextMenu) {
      setSpaceActionMenu(null)
    }
  }, [contextMenu])

  const resolveSpacePath = useCallback(
    (spaceId: string): string => {
      const space = spacesRef.current.find(candidate => candidate.id === spaceId)
      if (!space) {
        return workspacePath
      }

      const trimmed = space.directoryPath.trim()
      return trimmed.length > 0 ? trimmed : workspacePath
    },
    [spacesRef, workspacePath],
  )

  const handleCanvasClick = useCallback(() => {
    setSpaceActionMenu(null)
    setEmptySelectionPrompt(null)
    cancelSpaceRename()
  }, [cancelSpaceRename, setEmptySelectionPrompt])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    setSpaceActionMenu(null)
  }, [setContextMenu])

  const handlePaneClickWithSpaceMenuClose = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      setSpaceActionMenu(null)
      handlePaneClick(event)
    },
    [handlePaneClick],
  )

  const handlePaneContextMenuWithSpaceMenuClose = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      setSpaceActionMenu(null)
      handlePaneContextMenu(event)
    },
    [handlePaneContextMenu],
  )

  const handleNodeContextMenuWithSpaceMenuClose = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>) => {
      setSpaceActionMenu(null)
      handleNodeContextMenu(event, node)
    },
    [handleNodeContextMenu],
  )

  const handleSelectionContextMenuWithSpaceMenuClose = useCallback(
    (event: React.MouseEvent, selectedNodes: Node<TerminalNodeData>[]) => {
      setSpaceActionMenu(null)
      handleSelectionContextMenu(event, selectedNodes)
    },
    [handleSelectionContextMenu],
  )

  const openSpaceActionMenu = useCallback(
    (spaceId: string, anchor: { x: number; y: number }) => {
      const listPathOpeners = window.opencoveApi?.workspace?.listPathOpeners
      if (typeof listPathOpeners === 'function') {
        void listPathOpeners()
          .then(result => {
            setAvailablePathOpeners(result.openers)
          })
          .catch(() => {
            setAvailablePathOpeners([])
          })
      } else {
        setAvailablePathOpeners([])
      }

      setContextMenu(null)
      setSpaceActionMenu({ spaceId, x: anchor.x, y: anchor.y })
    },
    [setContextMenu],
  )

  const closeSpaceActionMenu = useCallback(() => {
    setSpaceActionMenu(null)
  }, [])

  const copySpacePath = useCallback(
    async (spaceId: string) => {
      const copyPath = window.opencoveApi?.workspace?.copyPath
      if (typeof copyPath !== 'function') {
        return
      }

      await copyPath({ path: resolveSpacePath(spaceId) })
    },
    [resolveSpacePath],
  )

  const openSpacePath = useCallback(
    async (spaceId: string, openerId: WorkspacePathOpenerId) => {
      const openPath = window.opencoveApi?.workspace?.openPath
      if (typeof openPath !== 'function') {
        return
      }

      await openPath({ path: resolveSpacePath(spaceId), openerId })
    },
    [resolveSpacePath],
  )

  const openSpaceCreateWorktree = useCallback((spaceId: string) => {
    setSpaceActionMenu(null)
    setSpaceWorktreeDialog({ spaceId, initialViewMode: 'create' })
  }, [])

  const openSpaceArchive = useCallback((spaceId: string) => {
    setSpaceActionMenu(null)
    setSpaceWorktreeDialog({ spaceId, initialViewMode: 'archive' })
  }, [])

  const closeSpaceWorktree = useCallback(() => {
    setSpaceWorktreeDialog(null)
  }, [])

  return {
    spaceActionMenu,
    spaceWorktreeDialog,
    availablePathOpeners,
    handleCanvasClick,
    closeContextMenu,
    handlePaneClickWithSpaceMenuClose,
    handlePaneContextMenuWithSpaceMenuClose,
    handleNodeContextMenuWithSpaceMenuClose,
    handleSelectionContextMenuWithSpaceMenuClose,
    openSpaceActionMenu,
    closeSpaceActionMenu,
    copySpacePath,
    openSpacePath,
    openSpaceCreateWorktree,
    openSpaceArchive,
    closeSpaceWorktree,
  }
}
