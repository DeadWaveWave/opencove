import { useEffect, type MutableRefObject } from 'react'
import type { WorkspaceCanvasNodeTypeProps } from './nodeTypes.types'
import type { NodeFrame } from '../../types'
import { useNodePosition } from './nodePosition'
import { usePluginEnabled } from '@contexts/plugins/presentation/renderer/usePluginEnabled'
import { usePluginManifest } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { GenericPluginView } from '@contexts/plugins/presentation/renderer/GenericPluginView'
import {
  setPluginWindowTitle,
  usePluginWindowTitle,
} from '@contexts/plugins/presentation/renderer/pluginWindowPresentation'
import { PluginUnavailableNode } from '../PluginUnavailableNode'
import { CanvasNodeWindow, type CanvasNodeWindowProps } from '../shared/CanvasNodeWindow'

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
  const manifest = usePluginManifest(data.plugin?.pluginId ?? '')
  const liveTitle = usePluginWindowTitle(id)
  useEffect(() => () => setPluginWindowTitle(id, null), [id])
  if (data.kind !== 'plugin' || !data.plugin) {
    return null
  }
  const windowProps: Omit<CanvasNodeWindowProps, 'children'> = {
    id,
    title: data.titlePinnedByUser ? data.title : (liveTitle ?? data.title),
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
  const unavailableReason = !manifest?.view
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
        testIdPrefix={`plugin-${data.plugin.pluginId}`}
        reason={unavailableReason}
      />
    )
  }
  if (manifest) {
    return (
      <CanvasNodeWindow
        {...windowProps}
        testIdPrefix={`plugin-${manifest.id}`}
        minSize={
          manifest.view
            ? { width: manifest.view.minWidth, height: manifest.view.minHeight }
            : undefined
        }
      >
        <GenericPluginView
          plugin={manifest}
          nodeId={id}
          workspaceId={
            typeof data.plugin.workspaceId === 'string' ? data.plugin.workspaceId : undefined
          }
          directoryPath={data.plugin.mountId ? undefined : data.plugin.repoPath}
          onTitleChange={title => setPluginWindowTitle(id, title)}
          onViewReset={() => setPluginWindowTitle(id, null)}
        />
      </CanvasNodeWindow>
    )
  }
  return null
}
