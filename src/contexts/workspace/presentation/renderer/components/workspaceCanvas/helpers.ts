import type { Node, ReactFlowInstance } from '@xyflow/react'
import { translate, type TranslateFn } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import {
  formatAppErrorMessage,
  getAppErrorDebugMessage,
  isAppErrorDescriptor,
  OpenCoveAppError,
} from '@shared/errors/appError'
import type { Point, Size, TaskPriority, TerminalNodeData, WorkspaceSpaceState } from '../../types'
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

export function centerNodeInViewport(
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>,
  node: Pick<Node<TerminalNodeData>, 'position' | 'data'>,
  options: { duration?: number; zoom: number },
): void {
  reactFlow.setCenter(
    node.position.x + node.data.width / 2,
    node.position.y + node.data.height / 2,
    {
      duration: resolveWorkspaceCanvasAnimationDuration(options.duration ?? 180),
      zoom: Number.isFinite(options.zoom) && options.zoom > 0 ? options.zoom : 1,
    },
  )
}

export function resolveNodePlacementAnchorFromViewportCenter(center: Point, size: Size): Point {
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
  }
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

export function normalizeTaskTagOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const normalized: string[] = []
  for (const tag of raw) {
    if (typeof tag !== 'string') {
      continue
    }

    const value = tag.trim()
    if (value.length === 0 || normalized.includes(value)) {
      continue
    }

    normalized.push(value)
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
  options?: { allowDirectoryMismatch?: boolean },
): string | null {
  if (nodeIds.length === 0) {
    return null
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const targetDirectory = resolveSpaceDirectoryPath(targetSpace, workspacePath)
  const allowDirectoryMismatch = options?.allowDirectoryMismatch === true

  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId)
    if (!node) {
      continue
    }

    if (node.data.kind === 'agent' && node.data.agent) {
      if (
        !allowDirectoryMismatch &&
        resolveNodeExecutionDirectory(node, workspacePath) !== targetDirectory
      ) {
        return t('messages.agentSpaceDirectoryMismatch')
      }

      continue
    }

    if (node.data.kind === 'terminal') {
      if (
        !allowDirectoryMismatch &&
        resolveNodeExecutionDirectory(node, workspacePath) !== targetDirectory
      ) {
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

export function toErrorMessage(error: unknown): string {
  if (error instanceof OpenCoveAppError) {
    const debug = getAppErrorDebugMessage(error)
    if (typeof debug === 'string' && error.code.startsWith('integration.github.')) {
      return normalizeIntegrationErrorMessage(debug)
    }

    return formatAppErrorMessage(error)
  }

  if (isAppErrorDescriptor(error)) {
    const debug = getAppErrorDebugMessage(error)
    if (typeof debug === 'string' && error.code.startsWith('integration.github.')) {
      return normalizeIntegrationErrorMessage(debug)
    }

    return formatAppErrorMessage(error)
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.length > 0) {
    return error
  }

  return translate('common.unknownError')
}

function normalizeIntegrationErrorMessage(message: string): string {
  return message.replace(/^[A-Za-z0-9_]+Error:\s*/, '')
}

export function providerLabel(provider: AgentProvider): string {
  return AGENT_PROVIDER_LABEL[provider]
}

export function providerTitlePrefix(provider: AgentProvider): string {
  if (provider === 'claude-code') {
    return 'claude'
  }

  if (provider === 'opencode') {
    return 'opencode'
  }

  if (provider === 'gemini') {
    return 'gemini'
  }

  return 'codex'
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
