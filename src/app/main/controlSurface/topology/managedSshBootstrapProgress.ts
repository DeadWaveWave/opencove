import type { ManagedSshEndpointOperationPhase } from '../../../../shared/contracts/dto'

export const MANAGED_SSH_BOOTSTRAP_PROGRESS_PREFIX = '[opencove-bootstrap-progress:v1]'
export const MANAGED_SSH_BOOTSTRAP_PHASES = [
  'checking_remote_runtime',
  'checking_installation',
  'downloading_installer',
  'installing_runtime',
  'starting_runtime',
  'waiting_for_runtime',
] as const satisfies readonly ManagedSshEndpointOperationPhase[]

const PHASES = new Set<string>(MANAGED_SSH_BOOTSTRAP_PHASES)
const MAX_LINE_LENGTH = 128

export function createManagedSshBootstrapProgressParser(
  onPhase: (phase: ManagedSshEndpointOperationPhase) => void,
): { push: (chunk: string) => void; finish: () => void } {
  let buffered = ''
  let discardLine = false
  const observeLine = (): void => {
    const line = buffered.endsWith('\r') ? buffered.slice(0, -1) : buffered
    const prefix = `${MANAGED_SSH_BOOTSTRAP_PROGRESS_PREFIX} `
    if (!discardLine && line.startsWith(prefix)) {
      const phase = line.slice(prefix.length)
      if (PHASES.has(phase)) {
        onPhase(phase as ManagedSshEndpointOperationPhase)
      }
    }
    buffered = ''
    discardLine = false
  }
  return {
    push: chunk => {
      let start = 0
      while (start < chunk.length) {
        const newline = chunk.indexOf('\n', start)
        const end = newline < 0 ? chunk.length : newline
        if (!discardLine) {
          if (buffered.length + end - start > MAX_LINE_LENGTH) {
            buffered = ''
            discardLine = true
          } else {
            buffered += chunk.slice(start, end)
          }
        }
        if (newline < 0) {
          break
        }
        observeLine()
        start = newline + 1
      }
    },
    finish: observeLine,
  }
}
