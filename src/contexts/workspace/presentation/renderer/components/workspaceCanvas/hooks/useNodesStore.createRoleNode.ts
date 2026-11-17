import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { ProjectRoleDefinition } from '@contexts/settings/domain/projectRoles'
import type {
  AgentProvider,
  StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import type { Point, TerminalNodeData } from '../../../types'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { guardNodeFromSyncOverwrite } from '../../../utils/syncNodeGuards'
import { resolveDefaultRoleWindowSize } from '../constants'
import type { NodePlacementOptions, ShowWorkspaceCanvasMessage } from '../types'
import type { CanvasDocumentWriteOptions } from './useNodesStore.types'
import { EMPTY_NODE_KIND_DATA } from './useNodesStore.nodeData'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: CanvasDocumentWriteOptions,
) => void

export function useWorkspaceCanvasRoleNodeCreation({
  workspaceId,
  onShowMessage,
  onNodeCreated,
  setNodes,
  standardWindowSizeBucket,
}: {
  workspaceId?: string
  onShowMessage?: ShowWorkspaceCanvasMessage
  onNodeCreated?: (nodeId: string) => void
  setNodes: SetNodes
  standardWindowSizeBucket: StandardWindowSizeBucket
}): {
  createRoleNode: (
    anchor: Point,
    role: ProjectRoleDefinition,
    placementOptions?: NodePlacementOptions & { selectedProvider?: AgentProvider | null },
  ) => Node<TerminalNodeData> | null
} {
  const { t } = useTranslation()
  const readDocument = useReadCanvasDocument()

  const createRoleNode = useCallback(
    (
      anchor: Point,
      role: ProjectRoleDefinition,
      placementOptions?: NodePlacementOptions & { selectedProvider?: AgentProvider | null },
    ): Node<TerminalNodeData> | null => {
      const defaultRoleSize = resolveDefaultRoleWindowSize(standardWindowSizeBucket)
      const resolvedPlacement = resolveNodesPlacement({
        workspaceId,
        getSpaces: () => readDocument().spaces,
        anchor,
        size: defaultRoleSize,
        getNodes: () => readDocument().nodes,
        targetSpaceRect: placementOptions?.targetSpaceRect ?? null,
        preferredDirection: placementOptions?.preferredDirection,
        avoidRects: placementOptions?.avoidRects,
      })

      if (resolvedPlacement.canPlace !== true) {
        onShowMessage?.(t('messages.noWindowSlotNearby'), 'warning')
        return null
      }

      const now = new Date().toISOString()
      const nextNode: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'roleNode',
        position: resolvedPlacement.placement,
        data: {
          sessionId: '',
          title: role.name,
          titlePinnedByUser: false,
          width: defaultRoleSize.width,
          height: defaultRoleSize.height,
          kind: 'role',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          ...EMPTY_NODE_KIND_DATA,
          role: {
            roleId: role.id,
            roleName: role.name,
            roleDescription: role.description,
            promptTemplate: role.promptTemplate,
            inputHint: role.inputHint,
            outputFormat: role.outputFormat,
            input: '',
            selectedProvider: placementOptions?.selectedProvider ?? null,
            linkedAgentNodeId: null,
            runHistory: [],
            createdAt: now,
            updatedAt: now,
          },
        },
        draggable: true,
        selectable: true,
      }

      guardNodeFromSyncOverwrite(nextNode.id, 2_500)
      setNodes(prevNodes => [...prevNodes, nextNode], { flush: true })
      onNodeCreated?.(nextNode.id)
      return nextNode
    },
    [
      onNodeCreated,
      onShowMessage,
      readDocument,
      setNodes,
      standardWindowSizeBucket,
      workspaceId,
      t,
    ],
  )

  return { createRoleNode }
}
