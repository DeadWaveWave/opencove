import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type {
  FocusNodeTargetZoom,
  StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ShowWorkspaceCanvasMessage, SpaceVisual } from '../types'
import type { LabelColor } from '@shared/types/labelColor'
import type { CanvasLod } from '../view/canvasLod'
import { computeSpaceRectFromNodes } from '../../../utils/spaceLayout'
import { useWorkspaceCanvasCreateSpace } from './useSpaces.createSpace'
import { useWorkspaceCanvasCreateChildSpace } from './useSpaces.createChildSpace'
import { useWorkspaceCanvasSpaceFocus } from './useSpaces.focus'
import { useCanvasUiCommands, useReadCanvasUi } from '../../../store/canvasStoreContext'

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
  onShowMessage,
}: UseWorkspaceCanvasSpacesParams): {
  activateSpaceTitle: (spaceId: string, lod: CanvasLod) => void
  commitSpaceRename: (spaceId: string) => void
  setSpaceLabelColor: (spaceId: string, labelColor: LabelColor | null) => void
  createSpaceFromSelectedNodes: () => void
  createChildSpaceInParent: (
    parentSpaceId: string,
    options?: { anchor?: { x: number; y: number } | null; nodeIds?: string[] },
  ) => string | null
  createEmptySpaceAtPoint: (point: { x: number; y: number }) => Promise<void>
  confirmSpaceTargetMountPicker: () => void
  cancelSpaceTargetMountPicker: () => void
  spaceVisuals: SpaceVisual[]
  activateSpace: (spaceId: string) => void
  activateAllSpaces: () => void
  setActiveSpaceIdFromNodeNavigation: (spaceId: string | null) => void
  focusSpaceInViewport: (spaceId: string) => boolean
  focusAllInViewport: () => void
} {
  const ui = useCanvasUiCommands()
  const readUi = useReadCanvasUi()

  useLayoutEffect(() => {
    spacesRef.current = spaces
  }, [spaces, spacesRef])

  useLayoutEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds
  }, [selectedNodeIds, selectedNodeIdsRef])

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
    const editingSpaceId = readUi().spaceRename?.spaceId
    if (editingSpaceId && !spaces.some(space => space.id === editingSpaceId)) {
      ui.cancelSpaceRename()
    }
  }, [readUi, spaces, ui])

  const { createChildSpaceInParent } = useWorkspaceCanvasCreateChildSpace({
    workspacePath,
    nodesRef,
    setNodes,
    spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
  })

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
    onShowMessage,
    createChildSpaceInParent,
  })

  const startSpaceRename = useCallback(
    (spaceId: string) => {
      // Prefer the render-prop `spaces` snapshot. Refs can lag behind React commits just long enough
      // for fast automated clicks (Playwright) to hit a space label before `spacesRef` updates.
      const space = spaces.find(item => item.id === spaceId)
      if (!space) {
        return
      }

      ui.startSpaceRename(space.id, space.name)
    },
    [ui, spaces],
  )

  const commitSpaceRename = useCallback(
    (spaceId: string) => {
      const rename = readUi().spaceRename
      if (!rename || rename.spaceId !== spaceId) {
        return
      }

      const normalizedName = rename.draft.trim()
      if (normalizedName.length === 0) {
        ui.cancelSpaceRename()
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
      ui.cancelSpaceRename()
    },
    [onSpacesChange, readUi, spacesRef, ui],
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
    ui.closeDialog('spaceTargetMountPicker')
  }, [ui])

  const confirmSpaceTargetMountPicker = useCallback(() => {
    const picker = readUi().spaceTargetMountPicker
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
    ui.closeDialog('spaceTargetMountPicker')
  }, [createSpaceWithTargetMount, readUi, ui])

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
  })

  const createEmptySpaceAtPoint = useCallback(
    async (point: { x: number; y: number }) => {
      const createdSpaceId = await createEmptySpaceAtPointInternal(point)
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

  // Far away a Space title is a way in, like a far tile: it focuses its Space. Up close, where the
  // Space can be read, it is the name and renames it.
  const activateSpaceTitle = useCallback(
    (spaceId: string, lod: CanvasLod) => {
      if (lod === 'far') {
        focusSpaceInViewport(spaceId)
        return
      }
      startSpaceRename(spaceId)
    },
    [focusSpaceInViewport, startSpaceRename],
  )

  return {
    activateSpaceTitle,
    commitSpaceRename,
    setSpaceLabelColor,
    createSpaceFromSelectedNodes,
    createChildSpaceInParent,
    createEmptySpaceAtPoint,
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
