import { useCallback, useRef, useState, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { WorkspacePathOpener, WorkspacePathOpenerId } from '@shared/contracts/dto'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { SpaceWorktreeOperationPhase, SpaceWorktreeOperationState } from '../types'
import { useCanvasUiCommands } from '../../../store/canvasStoreContext'

export function useWorkspaceCanvasSpaceUi({
  cancelSpaceRename,
  workspacePath,
  spacesRef,
  handlePaneClick,
  handlePaneContextMenu,
  handleNodeContextMenu,
  handleSelectionContextMenu,
}: {
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
  spaceWorktreeOperations: SpaceWorktreeOperationState[]
  availablePathOpeners: WorkspacePathOpener[]
  onCanvasClick: () => void
  onPaneClick: (event: React.MouseEvent | MouseEvent) => void
  onPaneContextMenu: (event: React.MouseEvent | MouseEvent) => void
  onNodeContextMenu: (event: React.MouseEvent, node: Node<TerminalNodeData>) => void
  onSelectionContextMenu: (event: React.MouseEvent, selectedNodes: Node<TerminalNodeData>[]) => void
  openSpaceActionMenu: (spaceId: string, anchor: { x: number; y: number }) => void
  copySpacePath: (spaceId: string) => Promise<void>
  openSpacePath: (spaceId: string, openerId: WorkspacePathOpenerId) => Promise<void>
  openSpaceCreateWorktree: (spaceId: string, anchor: { x: number; y: number }) => void
  openSpaceArchive: (spaceId: string, anchor: { x: number; y: number }) => void
  closeSpaceWorktree: (operationId: string) => void
  setSpaceWorktreeOperationPhase: (operationId: string, phase: SpaceWorktreeOperationPhase) => void
} {
  const ui = useCanvasUiCommands()
  const [spaceWorktreeOperations, setSpaceWorktreeOperations] = useState<
    SpaceWorktreeOperationState[]
  >([])
  const nextSpaceWorktreeOperationIdRef = useRef(0)
  const [availablePathOpeners, setAvailablePathOpeners] = useState<WorkspacePathOpener[]>([])

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

  const onCanvasClick = useCallback(() => {
    ui.closeSpaceActionMenu()
    cancelSpaceRename()
  }, [cancelSpaceRename, ui])

  const onPaneClick = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      ui.closeSpaceActionMenu()
      handlePaneClick(event)
    },
    [handlePaneClick, ui],
  )

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      ui.closeSpaceActionMenu()
      handlePaneContextMenu(event)
    },
    [handlePaneContextMenu, ui],
  )

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>) => {
      ui.closeSpaceActionMenu()
      handleNodeContextMenu(event, node)
    },
    [handleNodeContextMenu, ui],
  )

  const onSelectionContextMenu = useCallback(
    (event: React.MouseEvent, selectedNodes: Node<TerminalNodeData>[]) => {
      ui.closeSpaceActionMenu()
      handleSelectionContextMenu(event, selectedNodes)
    },
    [handleSelectionContextMenu, ui],
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

      ui.openSpaceActionMenu({ spaceId, x: anchor.x, y: anchor.y })
    },
    [ui],
  )

  const copySpacePath = useCallback(
    async (spaceId: string) => {
      const path = resolveSpacePath(spaceId)
      const copyPath = window.opencoveApi?.workspace?.copyPath
      if (typeof copyPath !== 'function') {
        try {
          const clipboard =
            typeof navigator === 'undefined' ? null : (navigator as Navigator).clipboard
          if (clipboard && typeof clipboard.writeText === 'function') {
            await clipboard.writeText(path)
          }
        } catch {
          // ignore clipboard failures (permissions, unavailable APIs, etc.)
        }

        return
      }

      await copyPath({ path })
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

  const openSpaceWorktreeOperation = useCallback(
    (
      spaceId: string,
      initialViewMode: SpaceWorktreeOperationState['initialViewMode'],
      anchor: { x: number; y: number },
    ) => {
      ui.closeSpaceActionMenu()
      const operationId = `space-worktree-${nextSpaceWorktreeOperationIdRef.current}`
      nextSpaceWorktreeOperationIdRef.current += 1
      setSpaceWorktreeOperations(previous => [
        ...previous.filter(operation => operation.phase === 'running'),
        {
          id: operationId,
          spaceId,
          initialViewMode,
          anchor,
          phase: 'draft',
        },
      ])
    },
    [ui],
  )

  const openSpaceCreateWorktree = useCallback(
    (spaceId: string, anchor: { x: number; y: number }) => {
      openSpaceWorktreeOperation(spaceId, 'create', anchor)
    },
    [openSpaceWorktreeOperation],
  )

  const openSpaceArchive = useCallback(
    (spaceId: string, anchor: { x: number; y: number }) => {
      openSpaceWorktreeOperation(spaceId, 'archive', anchor)
    },
    [openSpaceWorktreeOperation],
  )

  const closeSpaceWorktree = useCallback((operationId: string) => {
    setSpaceWorktreeOperations(previous =>
      previous.filter(operation => operation.id !== operationId),
    )
  }, [])

  const setSpaceWorktreeOperationPhase = useCallback(
    (operationId: string, phase: SpaceWorktreeOperationPhase) => {
      setSpaceWorktreeOperations(previous =>
        previous.map(operation =>
          operation.id === operationId ? { ...operation, phase } : operation,
        ),
      )
    },
    [],
  )

  return {
    spaceWorktreeOperations,
    availablePathOpeners,
    onCanvasClick,
    onPaneClick,
    onPaneContextMenu,
    onNodeContextMenu,
    onSelectionContextMenu,
    openSpaceActionMenu,
    copySpacePath,
    openSpacePath,
    openSpaceCreateWorktree,
    openSpaceArchive,
    closeSpaceWorktree,
    setSpaceWorktreeOperationPhase,
  }
}
