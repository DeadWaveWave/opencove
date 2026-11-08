import type { TranslateFn } from '@app/renderer/i18n'
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

export const MIN_WIDTH = 220
export const MIN_HEIGHT = 260

/** A session avatar is a 26px tile with a 4px gap. The rest of the row keeps the window's edges and
    the run button; the session hint takes what is left and gives way first, as the avatars say
    the same. */
const SESSION_AVATAR_PITCH = 30
const SESSION_ROW_RESERVED_WIDTH = 130
const MAX_SESSION_AVATARS = 6

/**
 * How many avatar slots a card of this width shows, and how many sessions fold into the last
 * slot's "+N" when they do not all fit. At least one slot, so a narrow card still reaches them.
 */
export function resolveSessionAvatarSlots(
  width: number,
  sessionCount: number,
): { visible: number; folded: number } {
  const slots = Math.min(
    MAX_SESSION_AVATARS,
    Math.max(1, Math.floor((width - SESSION_ROW_RESERVED_WIDTH) / SESSION_AVATAR_PITCH)),
  )
  if (sessionCount <= slots) {
    return { visible: sessionCount, folded: 0 }
  }

  return { visible: slots - 1, folded: sessionCount - (slots - 1) }
}

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

/** What a session's avatar says of its Agent: working, loading, failed, stopped, exited, standby. */
export function getAgentRuntimeLabel(t: TranslateFn, status: AgentRuntimeStatus | null): string {
  switch (status) {
    case 'running':
      return t('sidebar.status.working')
    case 'restoring':
      return t('common.loading')
    case 'failed':
      return t('agentRuntime.failed')
    case 'stopped':
      return t('agentRuntime.stopped')
    case 'exited':
      return t('agentRuntime.exited')
    default:
      return t('sidebar.status.standby')
  }
}
