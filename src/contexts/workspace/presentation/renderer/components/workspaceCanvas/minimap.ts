import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../types'
import { resolveWindowKindFamily } from '../../utils/windowKindFamily'

/** Minimap squares share the header tiles' kind families; see window-kind-identity.css. */
export function resolveWorkspaceMinimapNodeColor(node: Node<TerminalNodeData>): string {
  return `var(--cove-minimap-kind-${resolveWindowKindFamily(node.data)})`
}
