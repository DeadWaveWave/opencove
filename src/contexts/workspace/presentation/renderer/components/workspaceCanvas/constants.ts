import type { Size, TaskPriority } from '../../types'
import {
  resolveCanvasCanonicalBucketFromViewport,
  resolveCanonicalNodeMaxSize,
  resolveCanonicalNodeMinSize,
  resolveCanonicalNodeSize,
} from '../../utils/workspaceNodeSizing'
import {
  MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
} from '@contexts/settings/domain/agentSettings'

export const MIN_CANVAS_ZOOM = 0.1
export const MAX_CANVAS_ZOOM = 2
export const TRACKPAD_PAN_SCROLL_SPEED = 0.5
export const TRACKPAD_PINCH_SENSITIVITY = 0.01
export const TRACKPAD_GESTURE_LOCK_GAP_MS = 220

function clampScalePercent(scalePercent: number): number {
  if (!Number.isFinite(scalePercent)) {
    return MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT
  }

  return Math.min(
    MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
    Math.max(MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT, Math.round(scalePercent)),
  )
}

function clampSize(size: Size, min: Size, max: Size): Size {
  return {
    width: Math.max(min.width, Math.min(max.width, size.width)),
    height: Math.max(min.height, Math.min(max.height, size.height)),
  }
}

function applyScalePercentToCanonicalSize({
  size,
  scalePercent,
  kind,
}: {
  size: Size
  scalePercent: number
  kind: 'terminal' | 'agent'
}): Size {
  const percent = clampScalePercent(scalePercent)
  const scaled = {
    width: Math.round((size.width * percent) / 100),
    height: Math.round((size.height * percent) / 100),
  }

  return clampSize(scaled, resolveCanonicalNodeMinSize(kind), resolveCanonicalNodeMaxSize(kind))
}

export function resolveDefaultTaskWindowSize(viewport?: Partial<Size>): Size {
  const bucket = resolveCanvasCanonicalBucketFromViewport(viewport)
  return resolveCanonicalNodeSize({ kind: 'task', bucket })
}

export function resolveDefaultNoteWindowSize(viewport?: Partial<Size>): Size {
  const bucket = resolveCanvasCanonicalBucketFromViewport(viewport)
  return resolveCanonicalNodeSize({ kind: 'note', bucket })
}

export function resolveDefaultAgentWindowSize(
  scalePercent: number,
  viewport?: Partial<Size>,
): Size {
  const bucket = resolveCanvasCanonicalBucketFromViewport(viewport)
  const canonical = resolveCanonicalNodeSize({ kind: 'agent', bucket })
  return applyScalePercentToCanonicalSize({ size: canonical, scalePercent, kind: 'agent' })
}

export function resolveDefaultTerminalWindowSize(
  scalePercent: number,
  viewport?: Partial<Size>,
): Size {
  const bucket = resolveCanvasCanonicalBucketFromViewport(viewport)
  const canonical = resolveCanonicalNodeSize({ kind: 'terminal', bucket })
  return applyScalePercentToCanonicalSize({ size: canonical, scalePercent, kind: 'terminal' })
}

export const TASK_PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

export const TASK_PRIORITIES: TaskPriority[] = TASK_PRIORITY_OPTIONS.map(option => option.value)
