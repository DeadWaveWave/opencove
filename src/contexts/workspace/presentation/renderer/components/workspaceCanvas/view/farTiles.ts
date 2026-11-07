import type { Node } from '@xyflow/react'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { LabelColor } from '@shared/types/labelColor'
import type { TerminalNodeData, WorkspaceNodeKind } from '../../../types'
import { resolveAgentPresentationProvider } from '../../../utils/agentPresentation'
import { findLinkedTaskTitleForAgent, resolveAgentDisplayLabel } from '../../../utils/agentTitle'
import { resolveWindowKindFamily, type WindowKindFamily } from '../../../utils/windowKindFamily'
import { resolveWindowSignal, type WindowSignal } from '../../../utils/windowSignal'

/** One window drawn as a glass tile in far view, in canvas coordinates. */
export interface FarTile {
  id: string
  kind: WorkspaceNodeKind
  family: WindowKindFamily
  title: string
  signal: WindowSignal | null
  labelColor: LabelColor | null
  selected: boolean
  provider: AgentProvider | null
  /** What the kind icon needs: the plugin that draws the window, or the document's file. */
  pluginId: string | null
  filePath: string | null
  x: number
  y: number
  width: number
  height: number
}

/** An agent's tile says what its window header says: the logo already names the provider. */
function agentTileTitle(
  nodes: readonly Node<TerminalNodeData>[],
  node: Node<TerminalNodeData>,
  provider: AgentProvider,
): string {
  return resolveAgentDisplayLabel({
    provider,
    linkedTaskTitle:
      node.data.kind === 'agent' && node.data.agent
        ? findLinkedTaskTitleForAgent(nodes, node.id, node.data.agent.taskId ?? null)
        : null,
    fallbackTitle: node.data.title,
    preferFallbackTitle: node.data.titlePinnedByUser === true,
  })
}

/**
 * Collapsed windows keep their desktop icon and windows in a folded Space stay hidden: far view
 * only replaces what an expanded window would draw.
 */
export function buildFarTiles(nodes: readonly Node<TerminalNodeData>[]): FarTile[] {
  return nodes.flatMap(node => {
    const presentation = node.data.collapsePresentation
    if (node.hidden || presentation?.collapsed || presentation?.spaceHidden) {
      return []
    }
    const provider = resolveAgentPresentationProvider(node.data)
    return [
      {
        id: node.id,
        kind: node.data.kind,
        family: resolveWindowKindFamily(node.data),
        title: provider ? agentTileTitle(nodes, node, provider) : node.data.title,
        signal: resolveWindowSignal(node.data),
        labelColor:
          (node.data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null })
            .effectiveLabelColor ?? null,
        selected: node.selected === true,
        provider,
        pluginId: node.data.plugin?.pluginId ?? null,
        filePath: node.data.document?.uri ?? null,
        x: node.position.x,
        y: node.position.y,
        width: node.width ?? node.measured?.width ?? node.data.width,
        height: node.height ?? node.measured?.height ?? node.data.height,
      },
    ]
  })
}
