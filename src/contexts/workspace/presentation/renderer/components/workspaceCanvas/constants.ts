import type { Size, TaskPriority } from '../../types'
import {
  resolveCanvasCanonicalBucketFromViewport,
  resolveCanonicalNodeSize,
} from '../../utils/workspaceNodeSizing'

export const MIN_CANVAS_ZOOM = 0.1
export const MAX_CANVAS_ZOOM = 2
export const TRACKPAD_PAN_SCROLL_SPEED = 0.5
export const TRACKPAD_PINCH_SENSITIVITY = 0.01
export const TRACKPAD_GESTURE_LOCK_GAP_MS = 220

export function resolveDefaultTaskWindowSize(viewport?: Partial<Size>): Size {
  const bucket = resolveCanvasCanonicalBucketFromViewport(viewport)
  return resolveCanonicalNodeSize({ kind: 'task', bucket })
}

export function resolveDefaultNoteWindowSize(viewport?: Partial<Size>): Size {
  const bucket = resolveCanvasCanonicalBucketFromViewport(viewport)
  return resolveCanonicalNodeSize({ kind: 'note', bucket })
}

export function resolveDefaultAgentWindowSize(viewport?: Partial<Size>): Size {
  const bucket = resolveCanvasCanonicalBucketFromViewport(viewport)
  return resolveCanonicalNodeSize({ kind: 'agent', bucket })
}

export function resolveDefaultTerminalWindowSize(viewport?: Partial<Size>): Size {
  const bucket = resolveCanvasCanonicalBucketFromViewport(viewport)
  return resolveCanonicalNodeSize({ kind: 'terminal', bucket })
}

export const TASK_PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

export const TASK_PRIORITIES: TaskPriority[] = TASK_PRIORITY_OPTIONS.map(option => option.value)
