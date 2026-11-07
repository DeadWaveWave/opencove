import type { OperationId } from './command'
import { usage } from './errors'

export type Invoke = (id: OperationId, payload: unknown) => Promise<unknown>
export interface CallerIdentity {
  caller: string
  scope: string
  projectId: string | null
  spaceId: string | null
  nodeId: string | null
  sessionId: string | null
}

/** Only these public fields may leave the CLI; credentials never enter the projection. */
export function callerIdentity(value: unknown): CallerIdentity {
  const wire = value as Record<string, unknown>
  const id = (key: string) => (typeof wire[key] === 'string' && wire[key] ? wire[key] : null)
  return {
    caller: String(wire.kind),
    scope: String(wire.scopeTier),
    projectId: id('projectId'),
    spaceId: id('spaceId'),
    nodeId: id('nodeId'),
    sessionId: id('sessionId'),
  }
}

export const identityFields = ['caller', 'scope', 'projectId', 'spaceId', 'nodeId', 'sessionId']

export function selfUnavailable(kind: string): never {
  usage(
    `@self for ${kind} only works inside an OpenCove terminal.`,
    'It reads OPENCOVE_NODE_ID, OPENCOVE_SPACE_ID and OPENCOVE_PROJECT_ID, with system.whoami as a fallback for a session token.',
  )
}

/** Per-run cache only. Environment values locate targets; the server retains authority. */
export function sessionIdentity(env: Record<string, string | undefined>, invoke: Invoke) {
  let pending: Promise<CallerIdentity> | undefined
  const whoami = () => (pending ??= invoke('system.whoami', {}).then(callerIdentity))
  return {
    whoami,
    async self(kind: 'node' | 'space' | 'project'): Promise<string> {
      const fromEnv = env[`OPENCOVE_${kind.toUpperCase()}_ID`]
      if (env.OPENCOVE_ENV === '1' && fromEnv) {
        return fromEnv
      }
      const identity = await whoami()
      const id = identity[`${kind}Id`]
      if (identity.caller === 'session-grant' && kind === 'space' && !id) {
        usage(
          'This OpenCove terminal does not belong to a space.',
          'Use --space <selector> to choose a space, or run "opencove context" to inspect your project.',
        )
      }
      if (identity.caller !== 'session-grant' || !id) {
        selfUnavailable(kind)
      }
      return id
    },
  }
}
