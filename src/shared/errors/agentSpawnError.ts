import { shellWord } from '../utils/shellWord'

export const agentSpawnPresentations = {
  agentSpawnDepth: {
    message: 'This runtime would exceed the maximum agent lineage depth of 3.',
    hint: 'Ask the user to start a new agent.',
  },
  agentSpawnConcurrency: {
    message:
      'This agent tree has reached its limit of 6 active or starting agent-created runtimes.',
    hint: 'Wait for a session in this tree to exit, or stop one of its agents or terminals. Finishing a turn does not free a slot. You can also ask the user to start a new agent.',
  },
  agentSpawnRoute: {
    message: 'Agent sessions cannot start runtimes through this operation.',
    hint: 'Use "opencove node create agent" or "opencove node create terminal".',
  },
  agentSpawnCaller: {
    message: 'This session has no canvas node and cannot create agent or terminal runtimes.',
    hint: 'Ask the user to start an agent on the canvas, then use "opencove node create" from that agent.',
  },
  agentSpawnBinding: {
    message: 'This session is no longer the active runtime of its canvas node.',
    hint: 'Use the node’s current session, or ask the user to start a new agent.',
  },
  agentSpawnRemote: {
    message: 'Agent spawning across Workers is not supported.',
    hint: 'Ask the user to start the agent on the target Worker.',
  },
  agentSpawnAccounting: {
    message: 'OpenCove could not verify this agent tree’s running runtimes.',
    hint: 'Ask the user to check the affected runtimes and start a new agent on the canvas for further delegation.',
  },
  agentSpawnCapability: {
    message: 'This Worker does not support bounded agent spawning.',
    hint: 'Update the Worker before creating runtimes from an agent session.',
  },
} as const
export type SpawnForbiddenReason =
  | 'node_create_required'
  | 'caller_node_required'
  | 'caller_session_mismatch'
  | 'remote_spawning_unsupported'
export interface SpawnForbiddenDetails {
  reason: 'operation_denied'
  spawnReason: SpawnForbiddenReason
  retryable: false
  operationId: string
  message: string
  hint: string
}
export interface SpawnQuotaNode {
  nodeId: string
  title: string
  kind: string
  depth: number
  sessionId?: string | null
  sessionStartedAt?: string | null
  state: 'starting' | 'running'
}
export interface SpawnRecoveryAction {
  kind: 'stop_agent' | 'kill_session'
  nodeId: string
  command: string
}
export function spawnRecoveryAction(node: SpawnQuotaNode): SpawnRecoveryAction | undefined {
  // Terminal recovery requires a fresh node.sessionId lookup, not census identity.
  // Keep the portable two-step hint instead of publishing a shell-specific pipeline.
  if (node.kind !== 'agent') {
    return undefined
  }
  return {
    kind: 'stop_agent',
    nodeId: node.nodeId,
    command: `opencove agent stop --node ${shellWord(node.nodeId)}`,
  }
}
function spawnRecoveryHint(node: SpawnQuotaNode): string {
  const target = shellWord(node.nodeId)
  return node.kind === 'terminal'
    ? `read its current node.sessionId with opencove node get --node ${target} --fields sessionId, then stop the whole terminal with opencove session kill --session <sessionId>`
    : `stop with opencove agent stop --node ${target}`
}
export interface SpawnLimitDetails {
  nodes?: SpawnQuotaNode[]
  actions?: SpawnRecoveryAction[]
  reason: 'depth_limit' | 'concurrency_limit'
  retryable: false
  rootNodeId: string
  callerNodeId: string
  requestedKind: 'agent' | 'terminal'
  limit: number
  attemptedDepth?: number
  occupied?: number
}
export function agentSpawnErrorPresentation(error: { code?: string; details?: unknown }) {
  const details = error.details as
    | { spawnReason?: string; reason?: string; nodes?: SpawnQuotaNode[] }
    | undefined
  const key =
    error.code === 'agent.spawn_depth_limit'
      ? 'agentSpawnDepth'
      : error.code === 'agent.spawn_concurrency_limit'
        ? 'agentSpawnConcurrency'
        : error.code === 'common.unavailable' && details?.reason === 'spawn_accounting_unavailable'
          ? 'agentSpawnAccounting'
          : error.code === 'common.forbidden'
            ? (
                {
                  node_create_required: 'agentSpawnRoute',
                  caller_node_required: 'agentSpawnCaller',
                  caller_session_mismatch: 'agentSpawnBinding',
                  remote_spawning_unsupported: 'agentSpawnRemote',
                } as const
              )[details?.spawnReason as SpawnForbiddenReason]
            : undefined
  if (!key) {
    return undefined
  }
  const text = agentSpawnPresentations[key]
  const nodes =
    ['agentSpawnDepth', 'agentSpawnConcurrency'].includes(key) && Array.isArray(details?.nodes)
      ? details.nodes.slice(0, 6)
      : []
  const hint = nodes.length
    ? text.hint +
      ' Occupying nodes: ' +
      nodes
        .map(
          node =>
            `${JSON.stringify(node.title)} (${node.nodeId}, ${node.kind}, depth ${node.depth}, ${node.state}); ${spawnRecoveryHint(node)}`,
        )
        .join('; ') +
      '.'
    : text.hint
  return { key, ...text, hint }
}
export function spawnForbiddenDetails(
  spawnReason: SpawnForbiddenReason,
  operationId = 'node.create',
): SpawnForbiddenDetails {
  const presentation = agentSpawnErrorPresentation({
    code: 'common.forbidden',
    details: { spawnReason },
  })!
  return {
    reason: 'operation_denied',
    spawnReason,
    retryable: false,
    operationId,
    message: `${presentation.message} ${presentation.hint}`,
    hint: presentation.hint,
  }
}
