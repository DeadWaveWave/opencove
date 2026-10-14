import type { StatusPillTone } from '@app/renderer/components/ui/StatusPill'
import type { AgentRuntimeStatus } from '../../types'

/** Status hues are reserved for what needs attention; every other state reads as neutral. */
export function getStatusPillTone(status: AgentRuntimeStatus | null): StatusPillTone {
  switch (status) {
    case 'running':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'failed':
      return 'failed'
    case null:
    case 'standby':
    case 'exited':
    case 'stopped':
    case 'restoring':
      return 'neutral'
  }
}
