import { markClaudeClearDrain } from './managedClaudeClearHold'
import { randomUUID } from 'node:crypto'
import type { AgentHookChannel } from '../../../shared/runtime/agentHook/agentHookChannel'
import type { ManagedClaudeLaunchOwner } from '../../../contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import { ClaudeClearResumeBinding } from '../../../contexts/agent/application/ClaudeClearResumeBinding'
import { ClaudeResumeTranscriptReader } from '../../../contexts/agent/infrastructure/watchers/ClaudeResumeTranscriptReader'
import { managedClaudeWritesEnabled } from './managedClaudeCompatibility'

/** Composition only: the application owner decides qualification and durable transitions. */
export function createManagedClaudeClearRuntime(
  channels: readonly AgentHookChannel[],
  owner: ManagedClaudeLaunchOwner,
) {
  const producers = new Map<object, ClaudeClearResumeBinding>()
  const feedback = () =>
    // oxlint-disable-next-line no-console -- graceful drain diagnostics survive renderer disconnection.
    console.warn(
      '[OpenCove] The latest Claude conversation could not be confirmed for restart. OpenCove will restore the last confirmed conversation.',
    )
  const unsubscribe = channels.map(channel =>
    channel.onClaudeBindingEvidence?.(
      evidence => {
        if (
          process.env.OPENCOVE_EXPERIMENTAL_MANAGED_CLAUDE_BINDINGS !== '1' ||
          !managedClaudeWritesEnabled()
        ) {
          return
        }
        let producer = producers.get(evidence.credential)
        if (!producer) {
          const reader = new ClaudeResumeTranscriptReader(evidence.configDirectories)
          producer = new ClaudeClearResumeBinding({
            owner: owner.qualification,
            runtimeSessionId: evidence.sessionId,
            credential: evidence.credential,
            isCurrent: evidence.isCurrent,
            enabled: () =>
              managedClaudeWritesEnabled() &&
              process.env.OPENCOVE_EXPERIMENTAL_MANAGED_CLAUDE_BINDINGS === '1',
            createId: randomUUID,
            now: () => performance.now(),
            read: async (input, signal) => await reader.confirmCompletedTurn(input, signal),
            onDegraded: feedback,
          })
          producers.set(evidence.credential, producer)
        }
        producer.observe(evidence)
      },
      credential => {
        producers.get(credential)?.close()
        producers.delete(credential)
        void owner.qualification
          .drain({ credential, deadlineAt: performance.now() + 5000 })
          .then(result => {
            if (result.status === 'degraded') {
              feedback()
            }
          })
      },
    ),
  )
  return {
    async drain(deadlineAt: number) {
      markClaudeClearDrain()
      producers.forEach(producer => producer.close())
      const result = await owner.qualification.drain({ deadlineAt })
      if (result.status === 'degraded') {
        feedback()
      }
      return result
    },
    dispose() {
      unsubscribe.forEach(dispose => dispose?.())
      producers.forEach(producer => producer.close())
      producers.clear()
    },
  }
}
