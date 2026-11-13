import type { LineageQuota } from '../../../shared/contracts/dto/nodeLineage'
import type { CommandContext, OperationId } from './command'
import { usage } from './errors'

export type Invoke = (id: OperationId, payload: unknown) => Promise<unknown>
export interface CallerIdentity {
  lineageQuota?: LineageQuota
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
  const quota = wire.lineageQuota as LineageQuota | undefined
  return {
    ...(quota
      ? {
          lineageQuota: {
            depth: quota.depth,
            maxDepth: quota.maxDepth,
            liveInTree: quota.liveInTree,
            maxLiveInTree: quota.maxLiveInTree,
            ...(quota.remainingLiveInTree !== undefined
              ? { remainingLiveInTree: quota.remainingLiveInTree }
              : {}),
          },
        }
      : {}),
    caller: String(wire.kind),
    scope: String(wire.scopeTier),
    projectId: id('projectId'),
    spaceId: id('spaceId'),
    nodeId: id('nodeId'),
    sessionId: id('sessionId'),
  }
}

export const identityFields = [
  'caller',
  'scope',
  'projectId',
  'spaceId',
  'nodeId',
  'sessionId',
  'lineageQuota',
  ...['depth', 'maxDepth', 'liveInTree', 'maxLiveInTree', 'remainingLiveInTree'].map(
    field => `lineageQuota.${field}`,
  ),
]

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
      if (identity.caller === 'session-grant' && kind === 'node' && !id) {
        usage(
          'This session is not bound to a canvas node.',
          'Use --node <selector> to choose a node, or --space <selector> for node list and node create.',
        )
      }
      if (identity.caller === 'session-grant' && kind === 'space' && !id && !identity.nodeId) {
        usage(
          'This session has no Space.',
          'Use --space <selector> to choose a Space, or --project <selector> for project scope.',
        )
      }
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

/** Only default interactive identity output may append prose to the JSON value. */
export function identityText(
  value: unknown,
  { io, options }: Pick<CommandContext, 'io' | 'options'>,
): string | undefined {
  if (!io.stdout.isTTY || options.pretty || options.output || options.fields !== undefined) {
    return undefined
  }
  const result = value as { self?: CallerIdentity; lineageQuota?: LineageQuota }
  const quota = (result.self ?? result).lineageQuota
  return quota
    ? JSON.stringify(value) +
        `\nAgents: ${quota.liveInTree} of ${quota.maxLiveInTree} running in your tree; depth ${quota.depth} of ${quota.maxDepth}\n`
    : undefined
}
