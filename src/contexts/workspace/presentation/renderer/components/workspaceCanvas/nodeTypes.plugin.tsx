import { useEffect } from 'react'
import type { WorkspaceCanvasNodeTypeProps } from './nodeTypes.types'
import { useCanvasNodeCommands } from './nodeTypes.context'
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

export function WorkspaceCanvasPluginNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
  const windowCommands = useCanvasNodeCommands().window
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
      void windowCommands.close(id)
    },
    onResize: frame => windowCommands.resize(id, frame),
    onInteractionStart: ({ shiftKey }) => {
      windowCommands.select(id, shiftKey ? { toggle: true } : undefined)
      if (!shiftKey) {
        windowCommands.focusForInteraction(id)
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
        kindFamily={manifest.view?.kind ?? 'neutral'}
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
