import type { Node } from '@xyflow/react'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { LabelColor } from '@shared/types/labelColor'
import type { TerminalNodeData, WorkspaceNodeKind } from '../../../types'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'
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

function resolveProvider(data: TerminalNodeData): AgentProvider | null {
  if (data.kind === 'agent') {
    return data.agent?.provider ?? null
  }
  if (!resolveAgentPresentation(data).isAgent) {
    return null
  }
  return data.agentOverlay?.provider ?? data.terminalAgentBinding?.provider ?? null
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
    return [
      {
        id: node.id,
        kind: node.data.kind,
        family: resolveWindowKindFamily(node.data),
        title: node.data.title,
        signal: resolveWindowSignal(node.data),
        labelColor:
          (node.data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null })
            .effectiveLabelColor ?? null,
        selected: node.selected === true,
        provider: resolveProvider(node.data),
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
