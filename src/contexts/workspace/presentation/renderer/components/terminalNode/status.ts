import type { AgentRuntimeStatus } from '../../types'

export function getStatusClassName(status: AgentRuntimeStatus | null): string {
  switch (status) {
    case 'standby':
      return 'terminal-node__status--standby'
    case 'exited':
      return 'terminal-node__status--exited'
    case 'failed':
      return 'terminal-node__status--failed'
    case 'stopped':
      return 'terminal-node__status--stopped'
    case 'restoring':
      return 'terminal-node__status--restoring'
    case 'running':
    default:
      return 'terminal-node__status--running'
  }
}
