import { AGENT_PROVIDER_LABEL, type AgentProvider } from '../../../settings/agentConfig'
import type { TaskPriority, TerminalNodeData, WorkspaceSpaceState } from '../../types'
import { TASK_PRIORITIES } from './constants'
import type { TrackpadGestureAction, TrackpadGestureTarget } from './types'

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function resolveWheelAction(ctrlKey: boolean): TrackpadGestureAction {
  return ctrlKey ? 'pinch' : 'pan'
}

export function resolveWheelTarget(target: EventTarget | null): TrackpadGestureTarget {
  if (target instanceof Element && target.closest('.react-flow__node')) {
    return 'node'
  }

  return 'canvas'
}

export function normalizeTaskTagSelection(selection: string[], availableTags: string[]): string[] {
  const normalized: string[] = []

  for (const tag of selection) {
    const value = tag.trim()
    if (value.length === 0 || normalized.includes(value)) {
      continue
    }

    if (availableTags.includes(value)) {
      normalized.push(value)
    }
  }

  return normalized
}

export function normalizeTaskPriority(value: unknown): TaskPriority {
  if (typeof value !== 'string') {
    return 'medium'
  }

  const normalized = value.trim().toLowerCase()
  return TASK_PRIORITIES.includes(normalized as TaskPriority)
    ? (normalized as TaskPriority)
    : 'medium'
}

export function isAgentWorking(status: TerminalNodeData['status']): boolean {
  return status === 'running' || status === 'restoring'
}

export function toAgentRuntimeLabel(status: TerminalNodeData['status']): string {
  switch (status) {
    case 'running':
      return 'Working'
    case 'standby':
      return 'Standby'
    case 'restoring':
      return 'Restoring'
    case 'failed':
      return 'Failed'
    case 'stopped':
      return 'Stopped'
    case 'exited':
      return 'Exited'
    default:
      return 'Idle'
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.length > 0) {
    return error
  }

  return 'Unknown error'
}

export function providerLabel(provider: AgentProvider): string {
  return AGENT_PROVIDER_LABEL[provider]
}

export function providerTitlePrefix(provider: AgentProvider): string {
  return provider === 'codex' ? 'codex' : 'claude'
}

export function normalizeDirectoryPath(workspacePath: string, customDirectory: string): string {
  const trimmed = customDirectory.trim()
  if (trimmed.length === 0) {
    return ''
  }

  if (/^([a-zA-Z]:[\\/]|\/)/.test(trimmed)) {
    return trimmed
  }

  const base = workspacePath.replace(/[\\/]+$/, '')
  const normalizedCustom = trimmed.replace(/^[./\\]+/, '')
  return `${base}/${normalizedCustom}`
}

export function toSuggestedWorktreePath(workspacePath: string, provider: AgentProvider): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${workspacePath}/.cove/worktrees/${providerTitlePrefix(provider)}-${stamp}`
}

export function shouldKeepSpace(space: WorkspaceSpaceState): boolean {
  return space.nodeIds.length > 0
}

export function sanitizeSpaces(nextSpaces: WorkspaceSpaceState[]): WorkspaceSpaceState[] {
  return nextSpaces
    .map(space => ({
      ...space,
      nodeIds: [...new Set(space.nodeIds)],
    }))
    .filter(shouldKeepSpace)
}
