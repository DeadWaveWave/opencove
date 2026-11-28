import { useCallback, useEffect, useMemo } from 'react'
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
import {
  useCanvasDocumentCommands,
  useCanvasUiCommands,
  useReadCanvasUi,
} from '../../../store/canvasStoreContext'

interface UseWorkspaceCanvasSpacesParams {
  workspaceId: string
  activeSpaceId: string | null
  onActiveSpaceChange: (spaceId: string | null) => void
  workspacePath: string
  focusNodeTargetZoom: FocusNodeTargetZoom
  standardWindowSizeBucket: StandardWindowSizeBucket
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
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
  spaces,
  onShowMessage,
}: UseWorkspaceCanvasSpacesParams): {
  activateSpaceTitle: (spaceId: string, lod: CanvasLod) => void
  commitSpaceRename: (spaceId: string) => void
  setSpaceLabelColor: (spaceId: string, labelColor: LabelColor | null) => void
  createSpaceFromSelectedNodes: () => void
  createSpaceFromNodeDirectory: (nodeId: string) => void
  createChildSpaceInParent: (
    parentSpaceId: string,
    options?: { anchor?: { x: number; y: number } | null; nodeIds?: readonly string[] },
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
  const documentCommands = useCanvasDocumentCommands()

  useEffect(() => {
    const spacesNeedingRect = spaces.filter(space => !space.rect)
    if (spacesNeedingRect.length === 0) {
      return
    }

    const nodeById = new Map(nodes.map(node => [node.id, node]))

    // The recipe fills the rect of the store's Spaces that lack one; the Spaces it returns are the
    // ones it was given when none needs a rect, so nothing is written then.
    documentCommands.updateSpaces(currentSpaces => {
      let hasUpdated = false

      const nextSpaces = currentSpaces.map(space => {
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

      return hasUpdated ? nextSpaces : currentSpaces
    })
  }, [documentCommands, nodes, spaces])

  useEffect(() => {
    const editingSpaceId = readUi().spaceRename?.spaceId
    if (editingSpaceId && !spaces.some(space => space.id === editingSpaceId)) {
      ui.cancelSpaceRename()
    }
  }, [readUi, spaces, ui])

  const { createChildSpaceInParent } = useWorkspaceCanvasCreateChildSpace({
    workspacePath,
    onShowMessage,
  })

  const {
    createSpaceFromSelectedNodes,
    createSpaceFromNodeDirectory,
    createSpaceWithTargetMount,
    createEmptySpaceAtPoint: createEmptySpaceAtPointInternal,
  } = useWorkspaceCanvasCreateSpace({
    workspaceId,
    workspacePath,
    standardWindowSizeBucket,
    reactFlow,
    onShowMessage,
    createChildSpaceInParent,
  })

  const startSpaceRename = useCallback(
    (spaceId: string) => {
      // The label that was clicked was rendered from the render-prop `spaces`, so the rename starts
      // from that snapshot, whatever the store holds by now.
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

      documentCommands.updateSpaces(currentSpaces =>
        currentSpaces.map(space =>
          space.id === spaceId
            ? {
                ...space,
                name: normalizedName,
              }
            : space,
        ),
      )
      ui.cancelSpaceRename()
    },
    [documentCommands, readUi, ui],
  )

  const setSpaceLabelColor = useCallback(
    (spaceId: string, labelColor: LabelColor | null) => {
      documentCommands.updateSpaces(
        currentSpaces =>
          currentSpaces.map(space =>
            space.id === spaceId
              ? {
                  ...space,
                  labelColor,
                }
              : space,
          ),
        { flush: true },
      )
    },
    [documentCommands],
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
    createSpaceFromNodeDirectory,
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
