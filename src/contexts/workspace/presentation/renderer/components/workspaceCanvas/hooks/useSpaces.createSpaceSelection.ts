import type { TranslateFn } from '@app/renderer/i18n'
import type { ListMountsResult } from '@shared/contracts/dto'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { MutableRefObject } from 'react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'
import type { CanvasUiCommands } from '../../../store/canvasStore.ui'

type CreateSpacePayload = {
  nodeIds: string[]
  rect: WorkspaceSpaceRect | null
  targetMountId: string
  directoryPath: string
}

function isAbsolutePath(pathValue: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(pathValue)
}

export function createSpaceFromSelectedNodesWithMounts({
  selectedNodeIdsRef,
  reactFlow,
  workspaceId,
  workspacePath,
  createSpace,
  ui,
  onShowMessage,
  t,
}: {
  selectedNodeIdsRef: MutableRefObject<string[]>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  workspaceId: string
  workspacePath: string
  createSpace: (payload: CreateSpacePayload) => void
  ui: CanvasUiCommands
  onShowMessage?: ShowWorkspaceCanvasMessage
  t: TranslateFn
}): void {
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
          ui.closeContextMenu()
          ui.cancelSpaceRename()
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

        ui.openDialog('spaceTargetMountPicker', {
          nodeIds: selectedIds,
          rect: null,
          mounts: mountResult.mounts,
          selectedMountId: mountResult.mounts[0].mountId,
          anchor: (() => {
            const firstSelectedNode = reactFlow
              .getNodes()
              .find(node => selectedIds.includes(node.id))
            if (!firstSelectedNode) {
              return { x: 24, y: 24 }
            }

            return reactFlow.flowToScreenPosition({
              x:
                firstSelectedNode.position.x +
                (firstSelectedNode.measured?.width ?? firstSelectedNode.width ?? 240) +
                8,
              y: firstSelectedNode.position.y,
            })
          })(),
        })
        ui.closeContextMenu()
        ui.cancelSpaceRename()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        onShowMessage?.(t('messages.mountListFailed', { message }), 'error')
        ui.closeContextMenu()
        ui.cancelSpaceRename()
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
      ui.closeContextMenu()
      return
    }

    window.requestAnimationFrame(retryCommitSelectedNodes)
  }

  window.requestAnimationFrame(retryCommitSelectedNodes)
}
