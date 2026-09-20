import type { TranslateFn } from '@app/renderer/i18n'
import type { TerminalNodeData } from '../../../types'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'

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
