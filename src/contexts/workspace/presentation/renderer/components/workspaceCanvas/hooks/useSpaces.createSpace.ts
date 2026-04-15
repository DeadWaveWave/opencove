import { useCallback } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { ListMountsResult } from '@shared/contracts/dto'
import type {
  ContextMenuState,
  EmptySelectionPromptState,
  ShowWorkspaceCanvasMessage,
  SpaceTargetMountPickerState,
} from '../types'
import { sanitizeSpaces, validateSpaceTransfer } from '../helpers'
import {
  computeSpaceRectFromNodes,
  pushAwayLayout,
  type LayoutItem,
} from '../../../utils/spaceLayout'

function isAbsolutePath(pathValue: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(pathValue)
}

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export function useWorkspaceCanvasCreateSpace({
  workspaceId,
  workspacePath,
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
}: {
  workspaceId: string
  workspacePath: string
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
  setSpaceTargetMountPicker: React.Dispatch<
    React.SetStateAction<SpaceTargetMountPickerState | null>
  >
  cancelSpaceRename: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): {
  createSpaceFromSelectedNodes: () => void
  createSpaceWithTargetMount: (payload: {
    nodeIds: string[]
    rect: WorkspaceSpaceRect | null
    targetMountId: string
    directoryPath: string
  }) => void
} {
  const { t } = useTranslation()

  const createSpace = useCallback(
    (payload: {
      nodeIds: string[]
      rect: WorkspaceSpaceRect | null
      targetMountId: string
      directoryPath: string
    }) => {
      const normalizedNodeIds = payload.nodeIds.filter(nodeId =>
        nodesRef.current.some(node => node.id === nodeId),
      )
      if (normalizedNodeIds.length === 0) {
        onShowMessage?.(t('messages.spaceRequiresNode'), 'warning')
        setContextMenu(null)
        setEmptySelectionPrompt(null)
        return
      }

      const validationError = validateSpaceTransfer(
        normalizedNodeIds,
        nodesRef.current,
        null,
        workspacePath,
        t,
      )
      if (validationError) {
        onShowMessage?.(validationError, 'warning')
        return
      }

      const usedNames = new Set(spacesRef.current.map(space => space.name.toLowerCase()))
      let nextNumber = spacesRef.current.length + 1
      let normalizedName = t('space.defaultName', { count: nextNumber })
      while (usedNames.has(normalizedName.toLowerCase())) {
        nextNumber += 1
        normalizedName = t('space.defaultName', { count: nextNumber })
      }

      const assignedNodeSet = new Set(normalizedNodeIds)
      const normalizedSpaces = sanitizeSpaces(
        spacesRef.current.map(space => ({
          ...space,
          nodeIds: space.nodeIds.filter(nodeId => !assignedNodeSet.has(nodeId)),
        })),
      )

      const createdNodes = normalizedNodeIds
        .map(nodeId => nodesRef.current.find(node => node.id === nodeId))
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

      const nodeById = new Map(nodesRef.current.map(node => [node.id, node]))

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

      for (const node of nodesRef.current) {
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
      setNodes(
        prevNodes => {
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

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )

      onSpacesChange(nextSpaces)
      onRequestPersistFlush?.()
      setContextMenu(null)
      setEmptySelectionPrompt(null)
      setSpaceTargetMountPicker(null)
      cancelSpaceRename()
    },
    [
      cancelSpaceRename,
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      onSpacesChange,
      setContextMenu,
      setEmptySelectionPrompt,
      setNodes,
      setSpaceTargetMountPicker,
      spacesRef,
      workspacePath,
      t,
    ],
  )

  const createSpaceWithTargetMount = useCallback(
    (payload: {
      nodeIds: string[]
      rect: WorkspaceSpaceRect | null
      targetMountId: string
      directoryPath: string
    }) => {
      createSpace(payload)
    },
    [createSpace],
  )

  const createSpaceFromSelectedNodes = useCallback(() => {
    const resolveSelectedIds = (): string[] => {
      const selectedIdsRefValue = selectedNodeIdsRef.current
      if (selectedIdsRefValue.length > 0) {
        return selectedIdsRefValue
      }

      return reactFlow
        .getNodes()
        .filter(node => node.selected)
        .map(node => node.id)
    }

    const commitSelectedNodes = (): boolean => {
      const selectedIds = resolveSelectedIds()
      if (selectedIds.length === 0) {
        return false
      }

      void (async () => {
        try {
          let mountResult = await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
            kind: 'query',
            id: 'mount.list',
            payload: { projectId: workspaceId },
          })

          if (mountResult.mounts.length === 0) {
            const rootPath = workspacePath.trim()
            if (workspaceId.trim().length > 0 && rootPath.length > 0 && isAbsolutePath(rootPath)) {
              try {
                await window.opencoveApi.controlSurface.invoke({
                  kind: 'command',
                  id: 'mount.create',
                  payload: {
                    projectId: workspaceId,
                    endpointId: 'local',
                    rootPath,
                    name: null,
                  },
                })
                mountResult = await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
                  kind: 'query',
                  id: 'mount.list',
                  payload: { projectId: workspaceId },
                })
              } catch {
                // ignore
              }
            }
          }

          if (mountResult.mounts.length === 0) {
            onShowMessage?.(t('messages.projectHasNoMounts'), 'warning')
            setContextMenu(null)
            setEmptySelectionPrompt(null)
            cancelSpaceRename()
            return
          }

          if (mountResult.mounts.length === 1) {
            const mount = mountResult.mounts[0]
            createSpace({
              nodeIds: selectedIds,
              rect: null,
              targetMountId: mount.mountId,
              directoryPath: mount.rootPath,
            })
            return
          }

          setSpaceTargetMountPicker({
            nodeIds: selectedIds,
            rect: null,
            mounts: mountResult.mounts,
            selectedMountId: mountResult.mounts[0].mountId,
          })
          setContextMenu(null)
          setEmptySelectionPrompt(null)
          cancelSpaceRename()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          onShowMessage?.(t('messages.mountListFailed', { message }), 'error')
          setContextMenu(null)
          setEmptySelectionPrompt(null)
          cancelSpaceRename()
        }
      })()
      return true
    }

    if (commitSelectedNodes()) {
      return
    }

    let attemptsRemaining = 3

    const retryCommitSelectedNodes = () => {
      if (commitSelectedNodes()) {
        return
      }

      attemptsRemaining -= 1
      if (attemptsRemaining <= 0) {
        setContextMenu(null)
        return
      }

      window.requestAnimationFrame(retryCommitSelectedNodes)
    }

    window.requestAnimationFrame(retryCommitSelectedNodes)
  }, [
    cancelSpaceRename,
    createSpace,
    onShowMessage,
    reactFlow,
    selectedNodeIdsRef,
    setContextMenu,
    setEmptySelectionPrompt,
    setSpaceTargetMountPicker,
    t,
    workspaceId,
    workspacePath,
  ])

  return {
    createSpaceFromSelectedNodes,
    createSpaceWithTargetMount,
  }
}
