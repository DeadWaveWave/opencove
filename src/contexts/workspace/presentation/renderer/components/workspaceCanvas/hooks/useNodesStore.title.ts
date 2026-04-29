import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { buildAgentNodeTitle } from '../../../utils/agentTitle'

export function shouldRenameWorkspaceNode(node: Node<TerminalNodeData>, nodeId: string): boolean {
  return (
    node.id === nodeId &&
    (node.data.kind === 'terminal' || (node.data.kind === 'agent' && node.data.agent !== null))
  )
}

export function resolveRenamedWorkspaceNodeTitle(
  node: Node<TerminalNodeData>,
  normalizedTitle: string,
): string {
  if (node.data.kind !== 'agent' || !node.data.agent) {
    return normalizedTitle
  }

  const agentTitlePrefix = `${buildAgentNodeTitle(node.data.agent.provider, '')} · `
  return normalizedTitle.startsWith(agentTitlePrefix)
    ? normalizedTitle
    : buildAgentNodeTitle(node.data.agent.provider, normalizedTitle)
}
