import { randomUUID } from 'node:crypto'
import { AgentRunStateRuntime } from '../../../../contexts/agent/application/AgentRunStateRuntime'
import { AgentRunStateRegistry } from '../../../../contexts/agent/application/AgentRunStateRegistry'
import type { TerminalSessionStateEvent } from '../../../../shared/contracts/dto'
import type { SessionState } from './ptyStreamState'

export function createWorkerAgentRunState(
  epoch = randomUUID(),
  now = Date.now,
): AgentRunStateRuntime {
  return new AgentRunStateRuntime(
    new AgentRunStateRegistry({
      epoch,
      now,
      createTurnId: randomUUID,
      schedule: (callback, delay) => {
        const timer = setTimeout(callback, delay)
        timer.unref()
        return () => clearTimeout(timer)
      },
    }),
    now,
  )
}
export function connectAgentRunStateTransport(
  runtime: AgentRunStateRuntime,
  ensureSession: (id: string) => SessionState,
  broadcast: (event: TerminalSessionStateEvent) => void,
): void {
  const baseline = runtime.registry.list()
  runtime.registry.subscribe(
    { epoch: baseline.epoch, afterSeq: baseline.seq },
    { types: ['agent.state_changed'] },
    event => {
      if (event.type === 'resync_required') {
        return
      }
      const session = ensureSession(event.snapshot.sessionId)
      const projection = runtime.project(event.snapshot)
      session.agentStateBySource.clear()
      session.agentStateBySource.set(projection.source!, projection)
      broadcast(projection)
    },
  )
}
