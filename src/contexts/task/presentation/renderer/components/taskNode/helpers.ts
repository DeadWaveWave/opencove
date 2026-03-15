import type { AgentRuntimeStatus } from '@contexts/workspace/presentation/renderer/types'

export function shouldStopWheelPropagation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return true
  }

  const canvas = target.closest('.workspace-canvas')
  if (!(canvas instanceof HTMLElement)) {
    return true
  }

  return canvas.dataset.canvasInputMode !== 'trackpad'
}

export const MIN_WIDTH = 320
export const MIN_HEIGHT = 220

export function formatTaskTimestamp(timestamp: string | null): string {
  if (!timestamp) {
    return '--'
  }

  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return timestamp
  }

  return parsed.toISOString().replace('T', ' ').slice(0, 16)
}

type AgentSessionTone = 'working' | 'standby' | 'failed'

export function resolveAgentSessionTone(status: AgentRuntimeStatus | null): AgentSessionTone {
  if (status === 'running' || status === 'restoring') {
    return 'working'
  }

  if (status === 'failed') {
    return 'failed'
  }

  return 'standby'
}
