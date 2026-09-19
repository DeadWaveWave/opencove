import type { Node } from '@xyflow/react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'
import { collectSpaceNodeIds } from '../../../utils/canvasCollapse'

/** A collapsed parent represents every window it hides, including child Spaces. */
export function collectSpaceSummaryNodes(
  spaceId: string,
  spaces: WorkspaceSpaceState[],
  nodes: Node<TerminalNodeData>[],
): Node<TerminalNodeData>[] {
  const nodeIds = collectSpaceNodeIds(spaceId, spaces)
  return nodes.filter(node => nodeIds.has(node.id))
}

export function resolveSpaceSummaryStatus(
  data: TerminalNodeData,
  t: TranslateFn,
): { label: string; state: string } | null {
  const agent = resolveAgentPresentation(data)
  if (agent.isAgent) {
    const state = agent.status ?? 'observing'
    return {
      state,
      label: t(`agentRuntime.${state === 'running' ? 'working' : state}`),
    }
  }
  if (data.kind !== 'terminal') {
    return null
  }
  if (data.status === 'restoring' || data.runtimeSessionBinding?.phase === 'preparing') {
    return { state: 'restoring', label: t('spaceCollapse.terminalRestoring') }
  }
  if (data.endedAt || ['exited', 'failed', 'stopped'].includes(data.status ?? '')) {
    return { state: 'exited', label: t('spaceCollapse.terminalExited') }
  }
  // A live PTY says the session is connected, not that a shell command is busy.
  return data.sessionId
    ? { state: 'connected', label: t('spaceCollapse.terminalRunning') }
    : { state: 'restoring', label: t('spaceCollapse.terminalRestoring') }
}
