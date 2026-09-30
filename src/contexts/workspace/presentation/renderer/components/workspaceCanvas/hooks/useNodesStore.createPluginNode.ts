import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { resolveDefaultPluginWindowSize } from '../constants'
import type { PluginNodeData, Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'
import { guardNodeFromSyncOverwrite } from '../../../utils/syncNodeGuards'
import { EMPTY_NODE_KIND_DATA } from './useNodesStore.nodeData'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { isPluginEnabled } from '@contexts/settings/domain/pluginSettings'
import { getPluginManifest } from '@contexts/plugins/presentation/renderer/usePluginRegistry'

function findContainingSpace(
  spaces: WorkspaceSpaceState[],
  point: Point,
): WorkspaceSpaceState | null {
  return (
    spaces
      .filter(space => {
        const rect = space.rect
        return Boolean(
          rect &&
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height,
        )
      })
      .sort(
        (left, right) =>
          left.rect!.width * left.rect!.height - right.rect!.width * right.rect!.height,
      )[0] ?? null
  )
}

export function useWorkspaceCanvasPluginNodeCreation({
  workspaceId,
  workspacePath,
  nodesRef,
  spacesRef,
  setNodes,
  onRequestPersistFlush,
  onNodeCreated,
}: {
  workspaceId?: string
  workspacePath: string
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  setNodes: (updater: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => void
  onRequestPersistFlush?: () => void
  onNodeCreated?: (nodeId: string) => void
}): (anchor: Point, pluginId?: string) => Node<TerminalNodeData> | null {
  const { t } = useTranslation()

  return useCallback(
    (anchor: Point, pluginId = 'git-board'): Node<TerminalNodeData> | null => {
      // A gesture may have started before the plugin was disabled in another view.
      const manifest = getPluginManifest(pluginId)
      if (
        !manifest ||
        (manifest.source === 'local'
          ? manifest.enabled === false
          : !isPluginEnabled(useAppStore.getState().agentSettings, pluginId))
      ) {
        return null
      }
      const targetSpace = findContainingSpace(spacesRef.current, anchor)
      const size = manifest.view
        ? { width: manifest.view.width, height: manifest.view.height }
        : resolveDefaultPluginWindowSize()
      const placement = resolveNodesPlacement({
        workspaceId,
        getSpaces: () => spacesRef.current,
        anchor,
        size,
        getNodes: () => nodesRef.current,
        targetSpaceRect: targetSpace?.rect ?? null,
      })
      if (!placement.canPlace) {
        return null
      }

      const plugin: PluginNodeData = {
        pluginId,
        schemaVersion: 1,
        repoPath: targetSpace?.directoryPath ?? workspacePath,
        mountId: targetSpace?.targetMountId ?? null,
        graphLimit: 30,
        workspaceId: workspaceId ?? null,
      }
      const node: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'pluginNode',
        position: placement.placement,
        data: {
          sessionId: '',
          title: pluginId === 'git-board' ? t('plugins.gitBoard.title') : manifest.displayName,
          titlePinnedByUser: false,
          width: size.width,
          height: size.height,
          kind: 'plugin',
          status: null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          ...EMPTY_NODE_KIND_DATA,
          plugin,
        },
        draggable: true,
        selectable: true,
      }
      guardNodeFromSyncOverwrite(node.id, 2_500)
      setNodes(nodes => [...nodes, node])
      onNodeCreated?.(node.id)
      onRequestPersistFlush?.()
      return node
    },
    [
      nodesRef,
      onNodeCreated,
      onRequestPersistFlush,
      setNodes,
      spacesRef,
      t,
      workspaceId,
      workspacePath,
    ],
  )
}
