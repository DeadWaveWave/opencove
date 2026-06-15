import {
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import type { Size, TaskPriority } from '../../types'
import { resolveAgentNodeSize, resolveCanonicalNodeSize } from '../../utils/workspaceNodeSizing'

export const MIN_CANVAS_ZOOM = 0.1
export const MAX_CANVAS_ZOOM = 2
export const TRACKPAD_PAN_SCROLL_SPEED = 0.5
export const TRACKPAD_PINCH_SENSITIVITY = 0.01
export const TRACKPAD_GESTURE_LOCK_GAP_MS = 220
export const VIEWPORT_INTERACTION_SETTLE_MS = 220

export function resolveDefaultTaskWindowSize(
  bucket: StandardWindowSizeBucket = DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
): Size {
  return resolveCanonicalNodeSize({ kind: 'task', bucket })
}

export function resolveDefaultNoteWindowSize(
  bucket: StandardWindowSizeBucket = DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
): Size {
  return resolveCanonicalNodeSize({ kind: 'note', bucket })
}

export function resolveDefaultRoleWindowSize(
  bucket: StandardWindowSizeBucket = DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
): Size {
  return resolveCanonicalNodeSize({ kind: 'role', bucket })
}

export function resolveDefaultImageWindowSize(
  bucket: StandardWindowSizeBucket = DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
): Size {
  return resolveCanonicalNodeSize({ kind: 'image', bucket })
}

export function resolveDefaultAgentWindowSize(
  bucket: StandardWindowSizeBucket = DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
  provider?: AgentProvider | null,
): Size {
  return resolveAgentNodeSize({ bucket, provider })
}

export function resolveDefaultTerminalWindowSize(
  bucket: StandardWindowSizeBucket = DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
): Size {
  return resolveCanonicalNodeSize({ kind: 'terminal', bucket })
}

export function resolveDefaultDocumentWindowSize(
  bucket: StandardWindowSizeBucket = DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
): Size {
  return resolveCanonicalNodeSize({ kind: 'document', bucket })
}

export function resolveDefaultWebsiteWindowSize(
  bucket: StandardWindowSizeBucket = DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
): Size {
  return resolveCanonicalNodeSize({ kind: 'website', bucket })
}

export const TASK_PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

export const TASK_PRIORITIES: TaskPriority[] = TASK_PRIORITY_OPTIONS.map(option => option.value)
