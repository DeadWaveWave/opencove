import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { getPluginManifest } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { pluginErrorMessage } from '@contexts/plugins/presentation/renderer/pluginErrorMessage'
import { findContainingSpaceByAnchor } from './useInteractions.spaceAssignment'

export function useWorkspaceCanvasPluginNodeCreation({
  workspaceId,
  spacesRef,
  onNodeCreated,
  onShowMessage,
}: {
  workspaceId?: string
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  onNodeCreated?: (nodeId: string) => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): (anchor: Point, pluginId: string) => Node<TerminalNodeData> | null {
  return useCallback(
    (anchor: Point, pluginId: string): null => {
      // The manifest can change after a drag starts. The Worker checks it again on dispatch.
      const manifest = getPluginManifest(pluginId)
      if (
        !workspaceId ||
        !manifest?.view ||
        !manifest.nodeKinds.length ||
        manifest.enabled === false
      ) {
        return null
      }
      const targetSpace = findContainingSpaceByAnchor(spacesRef.current, anchor)
      // The Worker owns all creation, placement and singleton identity across projects/clients.
      void window.opencoveApi.controlSurface
        .invoke<{ nodeId: string; projectId: string; created: boolean }>({
          kind: 'command',
          id: 'plugin.window.open',
          payload: { pluginId, projectId: workspaceId, spaceId: targetSpace?.id, anchor },
        })
        .then(result => {
          if (result.created) {
            onNodeCreated?.(result.nodeId)
          }
          const store = useAppStore.getState()
          store.setActiveWorkspaceId(result.projectId)
          store.setFocusRequest(previous => ({
            kind: 'node',
            workspaceId: result.projectId,
            nodeId: result.nodeId,
            sequence: (previous?.sequence ?? 0) + 1,
          }))
        })
        .catch(error => onShowMessage?.(pluginErrorMessage(error), 'error'))
      return null
    },
    [onNodeCreated, onShowMessage, spacesRef, workspaceId],
  )
}
