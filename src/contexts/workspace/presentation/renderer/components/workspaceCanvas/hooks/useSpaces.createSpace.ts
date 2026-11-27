import { useCallback, useLayoutEffect, useMemo } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { sanitizeSpaces, validateSpaceTransfer } from '../helpers'
import { resolveTopLevelSpaceDirectoryFromNode } from './useFilesystemNodePaths'
import { listProjectMounts, resolveBestMount } from './spaceMountLaunchContext'
import { useCreateEmptySpace } from './useSpaces.createEmptySpace'
import { createSpaceFromSelectedNodesWithMounts } from './useSpaces.createSpaceSelection'
import { resolveSelectedChildSpaceParent } from './useSpaces.createChildSpace'
import {
  computeSpaceRectFromNodes,
  pushAwayLayout,
  type LayoutItem,
} from '../../../utils/spaceLayout'
import {
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasSelection,
} from '../../../store/canvasStoreContext'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
type UpdateCanvasDocument = UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
export function useWorkspaceCanvasCreateSpace({
  workspaceId,
  workspacePath,
  standardWindowSizeBucket,
  reactFlow,
  updateCanvasDocument,
  onShowMessage,
  createChildSpaceInParent,
}: {
  workspaceId: string
  workspacePath: string
  standardWindowSizeBucket: StandardWindowSizeBucket
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  updateCanvasDocument: UpdateCanvasDocument
  onShowMessage?: ShowWorkspaceCanvasMessage
  createChildSpaceInParent: (
    parentSpaceId: string,
    options?: { anchor?: { x: number; y: number } | null; nodeIds?: readonly string[] },
  ) => string | null
}): {
  createSpaceFromSelectedNodes: () => void
  createSpaceFromNodeDirectory: (nodeId: string) => void
  createEmptySpaceAtPoint: (point: { x: number; y: number }) => Promise<string | null>
  createSpaceWithTargetMount: (payload: {
    nodeIds: readonly string[]
    rect: WorkspaceSpaceRect | null
    targetMountId: string
    directoryPath: string
  }) => void
} {
  const ui = useCanvasUiCommands()
  const readSelection = useReadCanvasSelection()
  const readDocument = useReadCanvasDocument()

  const { t } = useTranslation()
  const lifetime = useMemo(
    () => ({ workspaceId, workspacePath, active: true }),
    [workspaceId, workspacePath],
  )
  useLayoutEffect(() => {
    lifetime.active = true
    return () => {
      lifetime.active = false
    }
  }, [lifetime])
  const resolveDefaultSpaceName = useCallback((): string => {
    const { spaces } = readDocument()
    const usedNames = new Set(spaces.map(space => space.name.toLowerCase()))
    let nextNumber = spaces.length + 1
    let normalizedName = t('space.defaultName', { count: nextNumber })
    while (usedNames.has(normalizedName.toLowerCase())) {
      nextNumber += 1
      normalizedName = t('space.defaultName', { count: nextNumber })
    }

    return normalizedName
  }, [readDocument, t])

  const createSpace = useCallback(
    (payload: {
      nodeIds: readonly string[]
      rect: WorkspaceSpaceRect | null
      targetMountId: string
      directoryPath: string
    }) => {
      // One read plans the whole change; the write below runs in the same call, so nothing can
      // land between them. The write's base is the store when it runs, which is this very document:
      // the Spaces the recipe returns are `document.spaces` planned forward and cannot differ from
      // what the write commits. The positions come from the same document too, so they differ
      // from the base's nodes only while a gesture holds live positions, as every committed read
      // does (Decision 5). A plan that crossed an await would have to be made again from the
      // recipe's own arguments.
      const document = readDocument()
      const normalizedNodeIds = payload.nodeIds.filter(nodeId =>
        document.nodes.some(node => node.id === nodeId),
      )
      if (normalizedNodeIds.length === 0) {
        onShowMessage?.(t('messages.spaceRequiresNode'), 'warning')
        ui.closeContextMenu()
        return
      }

      const validationError = validateSpaceTransfer(
        normalizedNodeIds,
        document.nodes,
        null,
        workspacePath,
        t,
      )
      if (validationError) {
        onShowMessage?.(validationError, 'warning')
        return
      }

      const normalizedName = resolveDefaultSpaceName()

      const assignedNodeSet = new Set(normalizedNodeIds)
      const normalizedSpaces = sanitizeSpaces(
        document.spaces.map(space => ({
          ...space,
          nodeIds: space.nodeIds.filter(nodeId => !assignedNodeSet.has(nodeId)),
        })),
      )

      const createdNodes = normalizedNodeIds
        .map(nodeId => document.nodes.find(node => node.id === nodeId))
        .filter((node): node is Node<TerminalNodeData> => Boolean(node))
      const rect =
        payload.rect ??
        computeSpaceRectFromNodes(
          createdNodes.map(node => ({
            x: node.position.x,
            y: node.position.y,
            width: node.data.width,
            height: node.data.height,
          })),
        )

      const nextSpaceId = crypto.randomUUID()
      const directoryPath =
        payload.directoryPath.trim().length > 0 ? payload.directoryPath.trim() : workspacePath
      const nextSpace: WorkspaceSpaceState = {
        id: nextSpaceId,
        name: normalizedName,
        directoryPath,
        targetMountId: payload.targetMountId,
        labelColor: null,
        nodeIds: normalizedNodeIds,
        rect,
      }

      const draftSpaces = sanitizeSpaces([...normalizedSpaces, nextSpace])

      const ownedNodeIds = new Set(draftSpaces.flatMap(space => space.nodeIds))
      const items: LayoutItem[] = []

      const nodeById = new Map(document.nodes.map(node => [node.id, node]))

      for (const space of draftSpaces) {
        if (!space.rect) {
          continue
        }

        items.push({
          id: space.id,
          kind: 'space',
          groupId: space.id,
          rect: { ...space.rect },
        })

        for (const nodeId of space.nodeIds) {
          const node = nodeById.get(nodeId)
          if (!node) {
            continue
          }

          items.push({
            id: node.id,
            kind: 'node',
            groupId: space.id,
            rect: {
              x: node.position.x,
              y: node.position.y,
              width: node.data.width,
              height: node.data.height,
            },
          })
        }
      }

      for (const node of document.nodes) {
        if (ownedNodeIds.has(node.id)) {
          continue
        }

        items.push({
          id: node.id,
          kind: 'node',
          groupId: node.id,
          rect: {
            x: node.position.x,
            y: node.position.y,
            width: node.data.width,
            height: node.data.height,
          },
        })
      }

      const pushed = pushAwayLayout({
        items,
        pinnedGroupIds: [nextSpaceId],
        sourceGroupIds: [nextSpaceId],
        directions: ['x+'],
        gap: 0,
      })

      const nextSpaceRectById = new Map(
        pushed.filter(item => item.kind === 'space').map(item => [item.id, item.rect]),
      )
      const nextNodePositionById = new Map(
        pushed
          .filter(item => item.kind === 'node')
          .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
      )

      const nextSpaces = draftSpaces.map(space => {
        const pushedRect = nextSpaceRectById.get(space.id)
        if (!pushedRect || !space.rect) {
          return space
        }

        if (
          pushedRect.x === space.rect.x &&
          pushedRect.y === space.rect.y &&
          pushedRect.width === space.rect.width &&
          pushedRect.height === space.rect.height
        ) {
          return space
        }

        return { ...space, rect: pushedRect }
      })

      const assignedNodeIdSet = new Set(normalizedNodeIds)
      const targetDirectoryPath = resolveSpaceWorkingDirectory(nextSpace, workspacePath)
      // The positions, the directories and the Spaces are one store update.
      updateCanvasDocument(
        ({ nodes: prevNodes }) => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            const nextPosition = nextNodePositionById.get(node.id)

            const isAssignedToNewSpace = assignedNodeIdSet.has(node.id)

            if (node.data.kind === 'agent' && node.data.agent && isAssignedToNewSpace) {
              const nextExpectedDirectory = targetDirectoryPath
              const hasPositionChange =
                nextPosition &&
                (node.position.x !== nextPosition.x || node.position.y !== nextPosition.y)

              const hasDirectoryChange = node.data.agent.expectedDirectory !== nextExpectedDirectory

              if (!hasPositionChange && !hasDirectoryChange) {
                return node
              }

              hasChanged = true
              return {
                ...node,
                ...(hasPositionChange ? { position: nextPosition } : null),
                data: {
                  ...node.data,
                  agent: {
                    ...node.data.agent,
                    expectedDirectory: nextExpectedDirectory,
                  },
                },
              }
            }

            if (node.data.kind === 'terminal' && isAssignedToNewSpace) {
              const executionDirectory =
                typeof node.data.executionDirectory === 'string' &&
                node.data.executionDirectory.trim().length > 0
                  ? node.data.executionDirectory
                  : workspacePath

              const nextExpectedDirectory = targetDirectoryPath

              const hasPositionChange =
                nextPosition &&
                (node.position.x !== nextPosition.x || node.position.y !== nextPosition.y)

              const hasDirectoryChange =
                node.data.executionDirectory !== executionDirectory ||
                node.data.expectedDirectory !== nextExpectedDirectory

              if (!hasPositionChange && !hasDirectoryChange) {
                return node
              }

              hasChanged = true
              return {
                ...node,
                ...(hasPositionChange ? { position: nextPosition } : null),
                data: {
                  ...node.data,
                  executionDirectory,
                  expectedDirectory: nextExpectedDirectory,
                },
              }
            }

            if (!nextPosition) {
              return node
            }

            if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              position: nextPosition,
            }
          })

          return { nodes: hasChanged ? nextNodes : prevNodes, spaces: nextSpaces }
        },
        { syncLayout: false, flush: true },
      )
      ui.closeContextMenu()
      ui.closeDialog('spaceTargetMountPicker')
      ui.cancelSpaceRename()
    },
    [
      onShowMessage,
      readDocument,
      resolveDefaultSpaceName,
      ui,
      updateCanvasDocument,
      workspacePath,
      t,
    ],
  )

  const createSpaceFromSelectedNodes = useCallback(() => {
    const selectedNodeIds = readSelection().nodeIds
    const selectedIds =
      selectedNodeIds.length > 0
        ? selectedNodeIds
        : reactFlow
            .getNodes()
            .filter(node => node.selected)
            .map(node => node.id)
    const selectedNodeIdSet = new Set(selectedIds)
    const document = readDocument()
    const selectedNodes = document.nodes.filter(node => selectedNodeIdSet.has(node.id))
    const selectedParentSpace = resolveSelectedChildSpaceParent({
      spaces: document.spaces,
      selectedNodes,
    })

    if (selectedParentSpace) {
      createChildSpaceInParent(selectedParentSpace.id, { nodeIds: selectedIds })
      return
    }

    createSpaceFromSelectedNodesWithMounts({
      readSelection,
      reactFlow,
      workspaceId,
      workspacePath,
      createSpace,
      ui,
      onShowMessage,
      t,
    })
  }, [
    createChildSpaceInParent,
    createSpace,
    onShowMessage,
    reactFlow,
    readDocument,
    readSelection,
    ui,
    t,
    workspaceId,
    workspacePath,
  ])

  const createSpaceFromNodeDirectory = useCallback(
    (nodeId: string) => {
      // Close the menu on click, before the query, like copyPath and blank-canvas create: a second
      // click is no longer possible from the UI. The post-query re-check below still keeps the
      // invariant if the document changes while mount.list is pending.
      ui.closeContextMenu()
      ui.cancelSpaceRename()
      const directoryPath = resolveTopLevelSpaceDirectoryFromNode(readDocument(), nodeId)
      if (!directoryPath) {
        onShowMessage?.(t('messages.spaceNodeHasNoDirectory'), 'warning')
        return
      }

      void (async () => {
        let mounts: Awaited<ReturnType<typeof listProjectMounts>>
        try {
          mounts = await listProjectMounts(workspaceId)
        } catch (error) {
          if (lifetime.active) {
            const message = error instanceof Error ? error.message : String(error)
            onShowMessage?.(t('messages.mountListFailed', { message }), 'error')
          }
          return
        }
        // A project switch or unmount during the query writes nothing, like blank-canvas create.
        if (!lifetime.active) {
          return
        }
        if (!mounts) {
          onShowMessage?.(
            t('messages.mountListFailed', {
              message: 'Control surface unavailable while resolving mounts.',
            }),
            'error',
          )
          return
        }
        // Re-run the same decision on the current document: a second call, a move into a Space, or
        // a folder navigation during the wait must not overwrite the newer state.
        const currentDirectory = resolveTopLevelSpaceDirectoryFromNode(readDocument(), nodeId)
        if (!currentDirectory) {
          return
        }
        const mount = resolveBestMount(mounts, currentDirectory)
        if (!mount) {
          onShowMessage?.(t('messages.spaceDirectoryOutsideMounts'), 'warning')
          return
        }
        createSpace({
          nodeIds: [nodeId],
          rect: null,
          targetMountId: mount.mountId,
          directoryPath: currentDirectory,
        })
      })()
    },
    [createSpace, lifetime, onShowMessage, readDocument, t, ui, workspaceId],
  )

  const createEmptySpaceAtPoint = useCreateEmptySpace({
    workspaceId,
    workspacePath,
    standardWindowSizeBucket,
    onShowMessage,
    resolveDefaultSpaceName,
  })

  return {
    createSpaceFromSelectedNodes,
    createSpaceFromNodeDirectory,
    createEmptySpaceAtPoint,
    createSpaceWithTargetMount: createSpace,
  }
}
