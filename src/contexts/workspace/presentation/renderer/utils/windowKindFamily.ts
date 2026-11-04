import type { TerminalNodeData } from '../types'
import { resolveAgentPresentation } from './agentPresentation'

/** Five checked colour families; windows in one family are told apart by their icons. */
export type WindowKindFamily = 'ai' | 'shell' | 'plan' | 'knowledge' | 'media' | 'neutral'

/** Derived from what a window is, never saved: an agent running in a terminal counts as AI. */
export function resolveWindowKindFamily(data: TerminalNodeData): WindowKindFamily {
  if (resolveAgentPresentation(data).isAgent) {
    return 'ai'
  }
  switch (data.kind) {
    case 'agent':
    case 'role':
      return 'ai'
    case 'terminal':
      return 'shell'
    case 'task':
      return 'plan'
    case 'note':
    case 'document':
      return 'knowledge'
    case 'website':
    case 'image':
      return 'media'
    default:
      return 'neutral'
  }
}
