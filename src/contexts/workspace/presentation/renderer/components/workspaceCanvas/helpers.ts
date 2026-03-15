import type { Node, ReactFlowInstance } from '/react'
import type { TranslateFn } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TaskPriority, TerminalNodeData, WorkspaceSpaceState } from '../../types'
import { TASK_PRIORITIES } from './constants'
import type { TrackpadGestureAction, TrackpadGestureTarget } from './types'

function isTestEnvironment(): boolean {
  return typeof window !== 'undefined' && window.opencoveApi?.meta?.isTest === true
}

export function resolveWorkspaceCanvasAnimationDuration(duration: number): number {
  // E2E runs in Electron where rAF can be throttled when the window is occluded on CI.
  // Keeping animations instantaneous in tests reduces reliance on frame scheduling.
  return isTestEnvironment() ? 0 : duration
}

export function focusNodeInViewport(
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>,
  node: Pick<Node<TerminalNodeData>, 'position' | 'data'>,
  options: { duration?: number; zoom?: number } = {},
): void {
  reactFlow.setCenter(
    node.position.x + node.data.width / 2,
    node.position.y + node.data.height / 2,
    {
      duration: resolveWorkspaceCanvasAnimationDuration(options.duration ?? 120),
      zoom: options.zoom ?? 1,
    },
  )
}

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

export function isAgentActive(status: TerminalNodeData['status']): boolean {
  return status === 'running' || status === 'standby' || status === 'restoring'
}

export function resolveSpaceDirectoryPath(
  space: WorkspaceSpaceState | null,
  workspacePath: string,
): string {
  return space && space.directoryPath.trim().length > 0 ? space.directoryPath : workspacePath
}

function resolveNodeExecutionDirectory(
  node: Node<TerminalNodeData>,
  workspacePath: string,
): string {
  if (node.data.kind === 'agent' && node.data.agent) {
    const directory = node.data.agent.executionDirectory.trim()
    return directory.length > 0 ? directory : workspacePath
  }

  if (typeof node.data.executionDirectory === 'string') {
    const directory = node.data.executionDirectory.trim()
    if (directory.length > 0) {
      return directory
    }
  }

  return workspacePath
}

export function validateSpaceTransfer(
  nodeIds: string[],
  nodes: Array<Node<TerminalNodeData>>,
  targetSpace: WorkspaceSpaceState | null,
  workspacePath: string,
  t: TranslateFn,
): string | null {
  if (nodeIds.length === 0) {
    return null
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const targetDirectory = resolveSpaceDirectoryPath(targetSpace, workspacePath)

  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId)
    if (!node) {
      continue
    }

    if (node.data.kind === 'agent' && node.data.agent) {
      if (resolveNodeExecutionDirectory(node, workspacePath) !== targetDirectory) {
        return t('messages.agentSpaceDirectoryMismatch')
      }

      continue
    }

    if (node.data.kind === 'terminal') {
      if (resolveNodeExecutionDirectory(node, workspacePath) !== targetDirectory) {
        return t('messages.terminalSpaceDirectoryMismatch')
      }

      continue
    }

    if (node.data.kind !== 'task' || !node.data.task) {
      continue
    }

    const linkedAgentNode = node.data.task.linkedAgentNodeId
      ? nodeById.get(node.data.task.linkedAgentNodeId)
      : null
    const hasActiveLinkedAgent =
      linkedAgentNode?.data.kind === 'agent' && isAgentActive(linkedAgentNode.data.status)

    if (node.data.task.status === 'doing' || hasActiveLinkedAgent) {
      return t('messages.taskSpaceMoveBlocked')
    }
  }

  return null
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
  return `${workspacePath}/.opencove/worktrees/${providerTitlePrefix(provider)}-${stamp}`
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
