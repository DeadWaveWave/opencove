import { AGENT_PROVIDERS, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type AgentLaunchMode,
  type AgentRuntimeStatus,
  type ExecutionDirectoryMode,
  type TaskPriority,
  type TaskRuntimeStatus,
  type WorkspaceSpaceRect,
  type WorkspaceViewport,
  type WorkspaceNodeKind,
} from '../../types'
import { MAX_PERSISTED_SCROLLBACK_CHARS } from './constants'

const AGENT_RUNTIME_STATUSES: AgentRuntimeStatus[] = [
  'running',
  'standby',
  'exited',
  'failed',
  'stopped',
  'restoring',
]

const TASK_RUNTIME_STATUSES: TaskRuntimeStatus[] = ['todo', 'doing', 'ai_done', 'done']
const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const AGENT_LAUNCH_MODES: AgentLaunchMode[] = ['new', 'resume']
const EXECUTION_DIRECTORY_MODES: ExecutionDirectoryMode[] = ['workspace', 'custom']

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function normalizeNodeKind(value: unknown): WorkspaceNodeKind {
  if (value === 'agent') {
    return 'agent'
  }

  if (value === 'task') {
    return 'task'
  }

  if (value === 'note') {
    return 'note'
  }

  if (value === 'image') {
    return 'image'
  }

  if (value === 'document') {
    return 'document'
  }

  if (value === 'website') {
    return 'website'
  }

  return 'terminal'
}

export function normalizeAgentRuntimeStatus(value: unknown): AgentRuntimeStatus | null {
  if (typeof value !== 'string') {
    return null
  }

  return AGENT_RUNTIME_STATUSES.includes(value as AgentRuntimeStatus)
    ? (value as AgentRuntimeStatus)
    : null
}

export function normalizeTaskRuntimeStatus(value: unknown): TaskRuntimeStatus {
  if (typeof value !== 'string') {
    return 'todo'
  }

  return TASK_RUNTIME_STATUSES.includes(value as TaskRuntimeStatus)
    ? (value as TaskRuntimeStatus)
    : 'todo'
}

export function normalizeTaskPriority(value: unknown): TaskPriority {
  if (typeof value !== 'string') {
    return 'medium'
  }

  return TASK_PRIORITIES.includes(value as TaskPriority) ? (value as TaskPriority) : 'medium'
}

export function normalizeTaskTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)),
  ]
}

export function normalizePullRequestBaseBranchOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = [
    ...new Set(value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)),
  ]

  return normalized.slice(0, 50)
}

export function normalizeLaunchMode(value: unknown): AgentLaunchMode {
  if (typeof value !== 'string') {
    return 'new'
  }

  return AGENT_LAUNCH_MODES.includes(value as AgentLaunchMode) ? (value as AgentLaunchMode) : 'new'
}

export function normalizeDirectoryMode(value: unknown): ExecutionDirectoryMode {
  if (typeof value !== 'string') {
    return 'workspace'
  }

  return EXECUTION_DIRECTORY_MODES.includes(value as ExecutionDirectoryMode)
    ? (value as ExecutionDirectoryMode)
    : 'workspace'
}

export function normalizeProvider(value: unknown): AgentProvider | null {
  if (typeof value !== 'string') {
    return null
  }

  return AGENT_PROVIDERS.includes(value as AgentProvider) ? (value as AgentProvider) : null
}

export function normalizeScrollback(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  if (value.length === 0) {
    return null
  }

  if (value.length <= MAX_PERSISTED_SCROLLBACK_CHARS) {
    return value
  }

  return value.slice(-MAX_PERSISTED_SCROLLBACK_CHARS)
}

export function normalizeTerminalGeometry(value: unknown): { cols: number; rows: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const cols = record.cols
  const rows = record.rows
  if (
    typeof cols !== 'number' ||
    !Number.isFinite(cols) ||
    typeof rows !== 'number' ||
    !Number.isFinite(rows)
  ) {
    return null
  }

  const normalizedCols = Math.floor(cols)
  const normalizedRows = Math.floor(rows)
  if (normalizedCols <= 0 || normalizedRows <= 0) {
    return null
  }

  return {
    cols: Math.min(1_000, normalizedCols),
    rows: Math.min(1_000, normalizedRows),
  }
}

export function normalizeWorkspaceViewport(value: unknown): WorkspaceViewport {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_WORKSPACE_VIEWPORT }
  }

  const record = value as Record<string, unknown>
  const x =
    typeof record.x === 'number' && Number.isFinite(record.x)
      ? record.x
      : DEFAULT_WORKSPACE_VIEWPORT.x
  const y =
    typeof record.y === 'number' && Number.isFinite(record.y)
      ? record.y
      : DEFAULT_WORKSPACE_VIEWPORT.y
  const zoom =
    typeof record.zoom === 'number' && Number.isFinite(record.zoom) && record.zoom > 0
      ? record.zoom
      : DEFAULT_WORKSPACE_VIEWPORT.zoom

  return {
    x,
    y,
    zoom,
  }
}

export function normalizeWorkspaceMinimapVisible(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_WORKSPACE_MINIMAP_VISIBLE
}

export function normalizeWorkspaceSpaceRect(value: unknown): WorkspaceSpaceRect | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const x = record.x
  const y = record.y
  const width = record.width
  const height = record.height

  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null
  }

  return {
    x,
    y,
    width,
    height,
  }
}

export function normalizeEnvironmentVariables(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const result: Record<string, string> = {}
  let count = 0

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const trimmedKey = typeof key === 'string' ? key.trim() : ''
    if (trimmedKey.length === 0) {
      continue
    }

    if (typeof val !== 'string') {
      continue
    }

    result[trimmedKey] = val
    count += 1

    if (count >= 100) {
      break
    }
  }

  return result
}

export function normalizeWorkspaceSpaceNodeIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(item => item.length > 0),
    ),
  ]
}
