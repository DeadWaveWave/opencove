// @vitest-environment node
import { registryWaitFixture } from './agentWaitRegistry.helpers'
import { waitForAgents, type WaitUntil } from '../../../src/app/cli/core/agentWait'
import type { AgentRunSnapshot } from '../../../src/shared/contracts/dto/agentRunState'

export function ownerFixture(legacy = false, staleBindings = legacy) {
  const f = registryWaitFixture(legacy, staleBindings)
  let time = 1000
  const sequences = new Map<string, number>()
  const register = (sessionId: string, nodeId = 'n') =>
    f.registry.register({ sessionId, nodeId, incarnation: sessionId, provider: 'codex' })
  const observe = (
    sessionId: string,
    state: AgentRunSnapshot['state'],
    boundary?: 'start' | 'completed',
  ) => {
    const sequence = (sequences.get(sessionId) ?? 0) + 1
    sequences.set(sessionId, sequence)
    f.registry.observe(sessionId, {
      incarnation: sessionId,
      source: state === 'exited' ? 'exit' : 'codex_hook',
      sourceSequence: sequence,
      observedAt: ++time,
      state,
      ...(boundary
        ? {
            boundary:
              boundary === 'start'
                ? { kind: 'start', evidence: 'task_started' }
                : { kind: 'end', outcome: boundary },
          }
        : {}),
    })
  }
  const controller = new AbortController()
  const wait = (
    nodeIds = ['n'],
    turnId?: string,
    any = false,
    until: WaitUntil = 'idle',
    timeoutMs = 1000,
  ) =>
    waitForAgents({
      nodeIds,
      turnId,
      until: turnId ? undefined : until,
      any,
      timeoutMs,
      query: f.query,
      fetch: f.fetch as typeof fetch,
      signal: controller.signal,
      connection: { endpoint: 'http://fake', token: 't' },
    })
  return { ...f, register, observeSession: observe, wait, controller }
}
