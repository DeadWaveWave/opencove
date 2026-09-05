import {
  createAgentHookChannel,
  type AgentHookChannel,
} from '../../../../shared/runtime/agentHook/agentHookChannel'
import { normalizePiAgentSnapshot } from '../../../../shared/runtime/piAgentSnapshot'
import { PiAgentObservationOwner } from '../../../../contexts/agent/domain/PiAgentObservationOwner'

import { PiSessionObservationWatcher } from '../../../../contexts/agent/infrastructure/watchers/PiSessionObservationWatcher'
import type { TerminalSessionStateEvent } from '../../../../shared/contracts/dto'

export function createPiHookChannel(): AgentHookChannel {
  const fallbackListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const channel = createAgentHookChannel({
    hookPath: '/hooks/pi',
    source: 'pi_hook',
    validateEnvelope: normalizePiAgentSnapshot,
    buildReservationEnv: (endpoint, token) => ({
      OPENCOVE_PI_HOOK_ENDPOINT: endpoint,
      OPENCOVE_PI_HOOK_TOKEN: token,
      OPENCOVE_PI_STATUS_OWNER_PID: '',
    }),
    createObservationOwner: () => {
      const owner = new PiAgentObservationOwner()
      let hasIdentity = false
      let fallback: PiSessionObservationWatcher | null = null
      return {
        accept: snapshot => {
          const observation = owner.accept(snapshot)
          if (!observation) {
            return null
          }
          hasIdentity ||= observation.identity !== null
          return {
            state: observation.state,
            stateMetadata: {
              piConversation: { pid: snapshot.pid, revision: snapshot.conversationRevision },
            },
            // Include the latest binding in every accepted snapshot, even before spawn commits.
            identity: hasIdentity
              ? {
                  identityAuthority: 'provider_session_snapshot' as const,
                  sequence: snapshot.sequence,
                  resumeSessionId: observation.resumeSessionId,
                }
              : null,
            metadata: {
              agentProvider: 'pi',
              resumeSessionId: observation.resumeSessionId,
              piSnapshot: observation.snapshot,
            },
          }
        },
        onCommittedObservation: (sessionId, snapshot, isCurrent) => {
          fallback ??= new PiSessionObservationWatcher({
            sessionId,
            onState: event => {
              if (isCurrent()) {
                fallbackListeners.forEach(listener => listener(event))
              }
            },
          })
          fallback.observe(snapshot)
        },
        dispose: () => {
          owner.dispose()
          fallback?.dispose()
        },
      }
    },
  })
  return {
    ...channel,
    onState: listener => {
      const unsubscribe = channel.onState(listener)
      fallbackListeners.add(listener)
      return () => {
        unsubscribe()
        fallbackListeners.delete(listener)
      }
    },
    dispose: async () => {
      await channel.dispose()
      fallbackListeners.clear()
    },
  }
}
