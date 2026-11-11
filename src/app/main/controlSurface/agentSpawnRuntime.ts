import { physicalSpawnLifecycle } from '../../../shared/runtime/physicalSpawnLifecycle'
import { SessionRegistrationOwner } from '../../../shared/runtime/sessionRegistrationOwner'
import type {
  AgentSpawnRuntimePort,
  NodeRuntimeBinding,
} from '../../../contexts/workspace/application/nodeSpawn/AgentSpawnRuntimePort'
import type { ControlSurfacePtyRuntime } from './handlers/sessionPtyRuntime'
import { canvasSpawnIdentity } from './sessionSpawnIdentityContext'

/** Owns exact incarnations independently of grants, node membership and kill requests. */
export function createAgentSpawnRuntime(runtime: ControlSurfacePtyRuntime) {
  const bindings = new Map<string, NodeRuntimeBinding>()
  const registrations = new SessionRegistrationOwner()
  let revision = 0
  const complete = (id: string) => {
    registrations.noteCompletion(id)
    if (bindings.delete(id)) {
      revision++
    }
  }
  const unsubscribe = runtime.onExit(event => complete(event.sessionId))
  const port: AgentSpawnRuntimePort = {
    snapshot: () => ({ revision, bindings: [...bindings.values()] }),
    isCurrent: value => revision === value,
  }
  return {
    port,
    runtime: {
      ...runtime,
      spawnSession: async input => {
        const identity = canvasSpawnIdentity.getStore()
        if (!identity?.nodeId) {
          return runtime.spawnSession(input)
        }
        const parent = physicalSpawnLifecycle.getStore()
        parent?.beginSpawn?.()
        parent?.beforeDispatch(input)
        const attempt = registrations.begin()
        const attemptState: { outcome: 'not_started' | 'started' | 'unknown' } = {
          outcome: 'not_started',
        }
        let sessionId: string | undefined
        let settled = false
        const started = (id: string) => {
          if (settled) {
            return
          }
          settled = true
          attemptState.outcome = 'started'
          sessionId = id
          if (attempt.complete(id) === 'active') {
            bindings.set(id, {
              nodeId: identity.nodeId!,
              sessionId: id,
              runtimeOwner: 'local',
              state: 'running',
            })
            revision++
          }
          parent?.started(id)
        }
        try {
          return await physicalSpawnLifecycle.run(
            {
              singleAttempt: parent?.singleAttempt,
              beforeDispatch: execution => parent?.beforeDispatch(execution ?? input),
              started,
              completed: id => {
                complete(id)
                parent?.completed(id)
              },
              unknown: completion => {
                attemptState.outcome = 'unknown'
                const key = `unknown:${identity.nodeId}:${revision}`
                bindings.set(key, {
                  nodeId: identity.nodeId!,
                  sessionId: key,
                  runtimeOwner: 'local',
                  state: 'unknown',
                })
                revision++
                void completion.then(() => complete(key))
                parent?.unknown(completion)
              },
            },
            async () => {
              const result = await runtime.spawnSession(input)
              started(result.sessionId) // Supports runtime adapters without an engine boundary.
              return result
            },
          )
        } catch (error) {
          if (attemptState.outcome === 'started' && sessionId && bindings.has(sessionId)) {
            try {
              runtime.kill(sessionId)
            } catch {
              /* Exact binding remains charged until exit. */
            }
          }
          throw error
        } finally {
          if (!settled) {
            attempt.cancel()
          }
        }
      },
    } satisfies ControlSurfacePtyRuntime,
    dispose: () => {
      unsubscribe()
      registrations.dispose()
      bindings.clear()
    },
  }
}
