import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type {
  ContextMenuState,
  EmptySelectionPromptState,
  ShowWorkspaceCanvasMessage,
  SpaceVisual,
} from '../types'
import { computeSpaceRectFromNodes } from '../../../utils/spaceLayout'
import { resolveWorkspaceCanvasAnimationDuration } from '../helpers'
import { useWorkspaceCanvasCreateSpace } from './useSpaces.createSpace'

interface UseWorkspaceCanvasSpacesParams {
  workspaceId: string
  activeSpaceId: string | null
  workspacePath: string
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  nodes: Node<TerminalNodeData>[]
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  spaces: WorkspaceSpaceState[]
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  selectedNodeIds: string[]
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
  onShowMessage?: ShowWorkspaceCanvasMessage
}

export function useWorkspaceCanvasSpaces({
  workspaceId,
  activeSpaceId,
  workspacePath,
  reactFlow,
  nodes,
  nodesRef,
  setNodes,
  spaces,
  spacesRef,
  selectedNodeIds,
  selectedNodeIdsRef,
  onSpacesChange,
  onRequestPersistFlush,
  setContextMenu,
  setEmptySelectionPrompt,
  onShowMessage,
}: UseWorkspaceCanvasSpacesParams): {
  editingSpaceId: string | null
  spaceRenameDraft: string
  setSpaceRenameDraft: React.Dispatch<React.SetStateAction<string>>
  spaceRenameInputRef: React.RefObject<HTMLInputElement | null>
  startSpaceRename: (spaceId: string) => void
  cancelSpaceRename: () => void
  commitSpaceRename: (spaceId: string) => void
  createSpaceFromSelectedNodes: () => void
  spaceVisuals: SpaceVisual[]
  focusSpaceInViewport: (spaceId: string) => void
  focusAllInViewport: () => void
} {
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null)
  const [spaceRenameDraft, setSpaceRenameDraft] = useState('')
  const spaceRenameInputRef = useRef<HTMLInputElement>(null)
  const lastAppliedWorkspaceIdRef = useRef<string | null>(null)
  const lastAppliedActiveSpaceIdRef = useRef<string | null | undefined>(undefined)

  useLayoutEffect(() => {
    spacesRef.current = spaces
  }, [spaces, spacesRef])

  useLayoutEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds
  }, [selectedNodeIds, selectedNodeIdsRef])

  useEffect(() => {
    setEditingSpaceId(null)
    setSpaceRenameDraft('')
  }, [workspaceId])

  useEffect(() => {
    const spacesNeedingRect = spaces.filter(space => !space.rect)
    if (spacesNeedingRect.length === 0) {
      return
    }

    const nodeById = new Map(nodes.map(node => [node.id, node]))
    let hasUpdated = false

    const nextSpaces = spaces.map(space => {
      if (space.rect) {
        return space
      }

      const ownedNodes = space.nodeIds
        .map(nodeId => nodeById.get(nodeId))
        .filter((node): node is Node<TerminalNodeData> => Boolean(node))

      if (ownedNodes.length === 0) {
        return space
      }

      hasUpdated = true
      return {
        ...space,
        rect: computeSpaceRectFromNodes(
          ownedNodes.map(node => ({
            x: node.position.x,
            y: node.position.y,
            width: node.data.width,
            height: node.data.height,
          })),
        ),
      }
    })

    if (hasUpdated) {
      onSpacesChange(nextSpaces)
    }
  }, [nodes, onSpacesChange, spaces])

  useEffect(() => {
    if (!editingSpaceId) {
      return
    }

    if (!spaces.some(space => space.id === editingSpaceId)) {
      setEditingSpaceId(null)
      setSpaceRenameDraft('')
    }
  }, [editingSpaceId, spaces])

  useEffect(() => {
    if (!editingSpaceId) {
      return
    }

    window.requestAnimationFrame(() => {
      const input = spaceRenameInputRef.current
      if (!input) {
        return
      }

      input.focus()
      input.select()
    })
  }, [editingSpaceId])

  const cancelSpaceRename = useCallback(() => {
    setEditingSpaceId(null)
    setSpaceRenameDraft('')
  }, [])

  const { createSpaceFromSelectedNodes } = useWorkspaceCanvasCreateSpace({
    workspacePath,
    nodesRef,
    setNodes,
    spacesRef,
    selectedNodeIdsRef,
    onSpacesChange,
    onRequestPersistFlush,
    setContextMenu,
    setEmptySelectionPrompt,
    cancelSpaceRename,
    onShowMessage,
  })

  const startSpaceRename = useCallback(
    (spaceId: string) => {
      const space = spacesRef.current.find(item => item.id === spaceId)
      if (!space) {
        return
      }

      setEditingSpaceId(space.id)
      setSpaceRenameDraft(space.name)
      setContextMenu(null)
      setEmptySelectionPrompt(null)
    },
    [setContextMenu, setEmptySelectionPrompt, spacesRef],
  )

  const commitSpaceRename = useCallback(
    (spaceId: string) => {
      const normalizedName = spaceRenameDraft.trim()
      if (normalizedName.length === 0) {
        cancelSpaceRename()
        return
      }

      const nextSpaces = spacesRef.current.map(space =>
        space.id === spaceId
          ? {
              ...space,
              name: normalizedName,
            }
          : space,
      )

      onSpacesChange(nextSpaces)
      cancelSpaceRename()
    },
    [cancelSpaceRename, onSpacesChange, spaceRenameDraft, spacesRef],
  )

  const spaceVisuals = useMemo<SpaceVisual[]>(() => {
    return spaces
      .map(space => {
        const rect = space.rect
        if (!rect) {
          return null
        }

        return {
          id: space.id,
          name: space.name,
          directoryPath: space.directoryPath,
          rect,
          hasExplicitRect: true,
        }
      })
      .filter((item): item is SpaceVisual => item !== null)
  }, [spaces])

  const focusSpaceInViewport = useCallback(
    (spaceId: string): void => {
      const targetSpace = spaceVisuals.find(space => space.id === spaceId)
      if (!targetSpace) {
        return
      }

      void reactFlow.fitBounds(targetSpace.rect, {
        padding: 0.16,
        duration: resolveWorkspaceCanvasAnimationDuration(220),
      })
    },
    [reactFlow, spaceVisuals],
  )

  const focusAllInViewport = useCallback((): void => {
    if (nodesRef.current.length === 0) {
      return
    }

    void reactFlow.fitView({
      padding: 0.16,
      duration: resolveWorkspaceCanvasAnimationDuration(220),
    })
  }, [nodesRef, reactFlow])

  useEffect(() => {
    if (lastAppliedWorkspaceIdRef.current !== workspaceId) {
      lastAppliedWorkspaceIdRef.current = workspaceId
      lastAppliedActiveSpaceIdRef.current = undefined
    }

    if (lastAppliedActiveSpaceIdRef.current === undefined) {
      lastAppliedActiveSpaceIdRef.current = activeSpaceId
      return
    }

    if (lastAppliedActiveSpaceIdRef.current === activeSpaceId) {
      return
    }

    lastAppliedActiveSpaceIdRef.current = activeSpaceId

    if (activeSpaceId) {
      focusSpaceInViewport(activeSpaceId)
      return
    }

    focusAllInViewport()
  }, [activeSpaceId, focusAllInViewport, focusSpaceInViewport, workspaceId])

  return {
    editingSpaceId,
    spaceRenameDraft,
    setSpaceRenameDraft,
    spaceRenameInputRef,
    startSpaceRename,
    cancelSpaceRename,
    commitSpaceRename,
    createSpaceFromSelectedNodes,
    spaceVisuals,
    focusSpaceInViewport,
    focusAllInViewport,
  }
}
