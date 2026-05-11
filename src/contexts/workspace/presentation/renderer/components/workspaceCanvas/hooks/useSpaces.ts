import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type {
  FocusNodeTargetZoom,
  StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type {
  ContextMenuState,
  EmptySelectionPromptState,
  ShowWorkspaceCanvasMessage,
  SpaceVisual,
  SpaceTargetMountPickerState,
} from '../types'
import type { LabelColor } from '@shared/types/labelColor'
import { computeSpaceRectFromNodes } from '../../../utils/spaceLayout'
import { useWorkspaceCanvasCreateSpace } from './useSpaces.createSpace'
import { useWorkspaceCanvasCreateChildSpace } from './useSpaces.createChildSpace'
import { useWorkspaceCanvasSpaceFocus } from './useSpaces.focus'

interface UseWorkspaceCanvasSpacesParams {
  workspaceId: string
  activeSpaceId: string | null
  onActiveSpaceChange: (spaceId: string | null) => void
  workspacePath: string
  focusNodeTargetZoom: FocusNodeTargetZoom
  standardWindowSizeBucket: StandardWindowSizeBucket
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
  onActiveSpaceChange,
  workspacePath,
  focusNodeTargetZoom,
  standardWindowSizeBucket,
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
  setSpaceLabelColor: (spaceId: string, labelColor: LabelColor | null) => void
  createSpaceFromSelectedNodes: () => void
  createChildSpaceFromSelectedNodes: () => void
  createChildSpaceInParent: (
    parentSpaceId: string,
    options?: { anchor?: { x: number; y: number } | null; nodeIds?: string[] },
  ) => string | null
  createEmptySpaceAtPoint: (point: { x: number; y: number }) => void
  spaceTargetMountPicker: SpaceTargetMountPickerState | null
  setSpaceTargetMountPicker: React.Dispatch<
    React.SetStateAction<SpaceTargetMountPickerState | null>
  >
  confirmSpaceTargetMountPicker: () => void
  cancelSpaceTargetMountPicker: () => void
  spaceVisuals: SpaceVisual[]
  activateSpace: (spaceId: string) => void
  activateAllSpaces: () => void
  setActiveSpaceIdFromNodeNavigation: (spaceId: string | null) => void
  focusSpaceInViewport: (spaceId: string) => boolean
  focusAllInViewport: () => void
} {
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null)
  const [spaceRenameDraft, setSpaceRenameDraft] = useState('')
  const spaceRenameInputRef = useRef<HTMLInputElement>(null)
  const [spaceTargetMountPicker, setSpaceTargetMountPicker] =
    useState<SpaceTargetMountPickerState | null>(null)

  useLayoutEffect(() => {
    spacesRef.current = spaces
  }, [spaces, spacesRef])

  useLayoutEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds
  }, [selectedNodeIds, selectedNodeIdsRef])

  useEffect(() => {
    setEditingSpaceId(null)
    setSpaceRenameDraft('')
    setSpaceTargetMountPicker(null)
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

  const {
    createSpaceFromSelectedNodes,
    createSpaceWithTargetMount,
    createEmptySpaceAtPoint: createEmptySpaceAtPointInternal,
  } = useWorkspaceCanvasCreateSpace({
    workspaceId,
    workspacePath,
    standardWindowSizeBucket,
    reactFlow,
    nodesRef,
    setNodes,
    spacesRef,
    selectedNodeIdsRef,
    onSpacesChange,
    onRequestPersistFlush,
    setContextMenu,
    setEmptySelectionPrompt,
    setSpaceTargetMountPicker,
    cancelSpaceRename,
    onShowMessage,
  })

  const { createChildSpaceInParent, createChildSpaceFromSelectedNodes } =
    useWorkspaceCanvasCreateChildSpace({
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
      // Prefer the render-prop `spaces` snapshot. Refs can lag behind React commits just long enough
      // for fast automated clicks (Playwright) to hit a space label before `spacesRef` updates.
      const space = spaces.find(item => item.id === spaceId)
      if (!space) {
        return
      }

      setEditingSpaceId(space.id)
      setSpaceRenameDraft(space.name)
      setContextMenu(null)
      setEmptySelectionPrompt(null)
    },
    [setContextMenu, setEmptySelectionPrompt, spaces],
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

  const setSpaceLabelColor = useCallback(
    (spaceId: string, labelColor: LabelColor | null) => {
      const nextSpaces = spacesRef.current.map(space =>
        space.id === spaceId
          ? {
              ...space,
              labelColor,
            }
          : space,
      )

      onSpacesChange(nextSpaces)
      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, onSpacesChange, spacesRef],
  )

  const cancelSpaceTargetMountPicker = useCallback(() => {
    setSpaceTargetMountPicker(null)
  }, [])

  const confirmSpaceTargetMountPicker = useCallback(() => {
    const picker = spaceTargetMountPicker
    if (!picker) {
      return
    }

    const selectedMount =
      picker.mounts.find(mount => mount.mountId === picker.selectedMountId) ?? null

    createSpaceWithTargetMount({
      nodeIds: picker.nodeIds,
      rect: picker.rect,
      targetMountId: picker.selectedMountId,
      directoryPath: selectedMount?.rootPath ?? '',
    })
    setSpaceTargetMountPicker(null)
  }, [createSpaceWithTargetMount, spaceTargetMountPicker])

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
          targetMountId: space.targetMountId,
          parentSpaceId: space.parentSpaceId ?? null,
          boundary: space.boundary ?? null,
          sortOrder: space.sortOrder ?? 0,
          labelColor: space.labelColor,
          rect,
          hasExplicitRect: true,
        }
      })
      .filter((item): item is SpaceVisual => item !== null)
  }, [spaces])

  const {
    activateSpace,
    activateAllSpaces,
    setActiveSpaceIdFromNodeNavigation,
    focusSpaceInViewport,
    focusAllInViewport,
  } = useWorkspaceCanvasSpaceFocus({
    workspaceId,
    activeSpaceId,
    onActiveSpaceChange,
    focusNodeTargetZoom,
    reactFlow,
    nodesRef,
    spacesRef,
    cancelSpaceRename,
  })

  const createEmptySpaceAtPoint = useCallback(
    (point: { x: number; y: number }) => {
      const createdSpaceId = createEmptySpaceAtPointInternal(point)
      if (!createdSpaceId) {
        return
      }

      const schedule =
        typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)

      schedule(() => {
        focusSpaceInViewport(createdSpaceId)
      })
    },
    [createEmptySpaceAtPointInternal, focusSpaceInViewport],
  )

  return {
    editingSpaceId,
    spaceRenameDraft,
    setSpaceRenameDraft,
    spaceRenameInputRef,
    startSpaceRename,
    cancelSpaceRename,
    commitSpaceRename,
    setSpaceLabelColor,
    createSpaceFromSelectedNodes,
    createChildSpaceFromSelectedNodes,
    createChildSpaceInParent,
    createEmptySpaceAtPoint,
    spaceTargetMountPicker,
    setSpaceTargetMountPicker,
    confirmSpaceTargetMountPicker,
    cancelSpaceTargetMountPicker,
    spaceVisuals,
    activateSpace,
    activateAllSpaces,
    setActiveSpaceIdFromNodeNavigation,
    focusSpaceInViewport,
    focusAllInViewport,
  }
}
