import type { TerminalNodeData } from '../types'
import { resolveAgentPresentation } from './agentPresentation'

/** What a window signals at a glance: only agents signal, and standby is quiet. */
export type WindowSignal = 'working' | 'waiting' | 'failed'

export function resolveWindowSignal(data: TerminalNodeData): WindowSignal | null {
  const presentation = resolveAgentPresentation(data)
  if (!presentation.isAgent) {
    return null
  }
  switch (presentation.status) {
    case 'failed':
      return 'failed'
    case 'waiting':
      return 'waiting'
    case null:
    case 'running':
    case 'restoring':
      return 'working'
    default:
      return null
  }
}
