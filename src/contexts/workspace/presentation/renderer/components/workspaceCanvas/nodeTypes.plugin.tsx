import type { MutableRefObject } from 'react'
import { GitBoardNode } from '../GitBoardNode'
import type { WorkspaceCanvasNodeTypeProps } from './nodeTypes.types'
import type { NodeFrame } from '../../types'
import { useNodePosition } from './nodePosition'
import { usePluginEnabled } from '@contexts/plugins/presentation/renderer/usePluginEnabled'
import { getBuiltinPluginManifest } from '@contexts/plugins/application/builtinPlugins'
import { PluginUnavailableNode } from '../PluginUnavailableNode'
import type { CanvasNodeWindowProps } from '../shared/CanvasNodeWindow'

export function WorkspaceCanvasPluginNodeType({
  data,
  id,
  closeNodeRef,
  resizeNodeRef,
  selectNode,
  normalizeViewportForTerminalInteractionRef,
}: WorkspaceCanvasNodeTypeProps & {
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, frame: NodeFrame) => void>
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
}) {
  const nodePosition = useNodePosition(id)
  const enabled = usePluginEnabled(data.plugin?.pluginId ?? '')
  if (data.kind !== 'plugin' || !data.plugin) {
    return null
  }
  const windowProps: Omit<CanvasNodeWindowProps, 'children'> = {
    id,
    title: data.title,
    pluginId: data.plugin.pluginId,
    position: nodePosition,
    width: data.width,
    height: data.height,
    onClose: () => {
      void closeNodeRef.current(id)
    },
    onResize: frame => resizeNodeRef.current(id, frame),
    onInteractionStart: ({ shiftKey }) => {
      selectNode(id, shiftKey ? { toggle: true } : undefined)
      if (!shiftKey) {
        normalizeViewportForTerminalInteractionRef.current(id)
      }
    },
  }
  const unavailableReason = !getBuiltinPluginManifest(data.plugin.pluginId)
    ? 'missing'
    : data.plugin.schemaVersion !== 1
      ? 'schemaUnavailable'
      : !enabled
        ? 'disabled'
        : null
  if (unavailableReason) {
    return (
      <PluginUnavailableNode
        {...windowProps}
        className="git-board-node"
        testIdPrefix="git-board"
        reason={unavailableReason}
      />
    )
  }
  return <GitBoardNode {...windowProps} data={data.plugin} />
}
