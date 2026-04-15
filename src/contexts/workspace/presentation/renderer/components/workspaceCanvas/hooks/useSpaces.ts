import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getViewportForBounds, useStore, type Node, type ReactFlowInstance } from '@xyflow/react'
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
import { resolveWorkspaceCanvasAnimationDuration } from '../helpers'
import { useWorkspaceCanvasCreateSpace } from './useSpaces.createSpace'

const DEFAULT_VIEWPORT_WIDTH = 1440
const DEFAULT_VIEWPORT_HEIGHT = 900

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
  focusSpaceInViewport: (spaceId: string) => void
  focusAllInViewport: () => void
} {
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null)
  const [spaceRenameDraft, setSpaceRenameDraft] = useState('')
  const spaceRenameInputRef = useRef<HTMLInputElement>(null)
  const [spaceTargetMountPicker, setSpaceTargetMountPicker] =
    useState<SpaceTargetMountPickerState | null>(null)
  const lastAppliedWorkspaceIdRef = useRef<string | null>(null)
  const lastAppliedActiveSpaceIdRef = useRef<string | null | undefined>(undefined)
  const viewportWidth = useStore(state => state.width)
  const viewportHeight = useStore(state => state.height)
  const viewportMinZoom = useStore(state => state.minZoom)
  const viewportMaxZoom = useStore(state => state.maxZoom)

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
          labelColor: space.labelColor,
          rect,
          hasExplicitRect: true,
        }
      })
      .filter((item): item is SpaceVisual => item !== null)
  }, [spaces])

  const focusSpaceInViewport = useCallback(
    (spaceId: string): void => {
      const space = spacesRef.current.find(item => item.id === spaceId) ?? null
      if (!space) {
        return
      }

      const rect =
        space.rect ??
        (() => {
          const nodeById = new Map(nodesRef.current.map(node => [node.id, node]))
          const ownedNodes = space.nodeIds
            .map(nodeId => nodeById.get(nodeId))
            .filter((node): node is Node<TerminalNodeData> => Boolean(node))

          if (ownedNodes.length === 0) {
            return null
          }

          return computeSpaceRectFromNodes(
            ownedNodes.map(node => ({
              x: node.position.x,
              y: node.position.y,
              width: node.data.width,
              height: node.data.height,
            })),
          )
        })()

      if (!rect) {
        return
      }

      const width = viewportWidth > 0 ? viewportWidth : DEFAULT_VIEWPORT_WIDTH
      const height = viewportHeight > 0 ? viewportHeight : DEFAULT_VIEWPORT_HEIGHT
      const maxZoom = Math.max(viewportMinZoom, Math.min(viewportMaxZoom, focusNodeTargetZoom))
      const nextViewport = getViewportForBounds(rect, width, height, viewportMinZoom, maxZoom, 0.16)

      void reactFlow.setViewport(nextViewport, {
        duration: resolveWorkspaceCanvasAnimationDuration(220),
      })
    },
    [
      focusNodeTargetZoom,
      nodesRef,
      reactFlow,
      spacesRef,
      viewportHeight,
      viewportMaxZoom,
      viewportMinZoom,
      viewportWidth,
    ],
  )

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

  const focusAllInViewport = useCallback((): void => {
    if (nodesRef.current.length === 0) {
      return
    }

    void reactFlow.fitView({
      padding: 0.16,
      duration: resolveWorkspaceCanvasAnimationDuration(220),
    })
  }, [nodesRef, reactFlow])

  const activateSpace = useCallback(
    (spaceId: string): void => {
      if (!spacesRef.current.some(space => space.id === spaceId)) {
        return
      }

      cancelSpaceRename()
      if (activeSpaceId === spaceId) {
        focusSpaceInViewport(spaceId)
        return
      }

      onActiveSpaceChange(spaceId)
    },
    [activeSpaceId, cancelSpaceRename, focusSpaceInViewport, onActiveSpaceChange, spacesRef],
  )

  const activateAllSpaces = useCallback((): void => {
    cancelSpaceRename()
    if (activeSpaceId === null) {
      focusAllInViewport()
      return
    }

    onActiveSpaceChange(null)
  }, [activeSpaceId, cancelSpaceRename, focusAllInViewport, onActiveSpaceChange])

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
    setSpaceLabelColor,
    createSpaceFromSelectedNodes,
    createEmptySpaceAtPoint,
    spaceTargetMountPicker,
    setSpaceTargetMountPicker,
    confirmSpaceTargetMountPicker,
    cancelSpaceTargetMountPicker,
    spaceVisuals,
    activateSpace,
    activateAllSpaces,
    focusSpaceInViewport,
    focusAllInViewport,
  }
}
