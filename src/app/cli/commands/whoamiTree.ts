import type { AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import { spawnRecoveryAction } from '../../../shared/errors/agentSpawnError'
import type { CommandContext, TextOutputContext } from '../core/command'
import type { CallerIdentity } from '../core/identity'
import { callerIdentity, identityText, lineageQuotaSummary } from '../core/identity'
import { CliError } from '../core/errors'
import { safeTerminalText } from '../core/errorPresentation'
import { shellWord } from '../core/shellWord'

export async function whoamiTree(ctx: CommandContext) {
  const identity = ctx.options.tree
    ? callerIdentity(await ctx.invoke('system.whoami', { includeTree: true }), true)
    : await ctx.whoami()
  if (!ctx.options.tree || !identity.nodeId || identity.caller !== 'session-grant') {
    return identity
  }
  const quota = identity.lineageQuota
  if (!quota?.nodes) {
    if (quota && ctx.io.stderr.isTTY && ctx.options.output !== 'json') {
      ctx.io.stderr.write(lineageQuotaSummary(quota))
    }
    throw new CliError(
      'cli.unsupported',
      5,
      'This Worker cannot show the occupants of your agent tree.',
      'Update OpenCove and its Worker, then run opencove whoami --tree again.',
      { identity },
    )
  }
  let agents: AgentRunSnapshot[] = []
  try {
    const result = (await ctx.invoke('agent.list', {})) as { agents: AgentRunSnapshot[] }
    agents = Array.isArray(result.agents) ? result.agents : []
  } catch (error) {
    if (ctx.io.signal?.aborted || (error instanceof CliError && error.exitCode === 130)) {
      throw error
    }
    ctx.io.stderr.write(
      'Notice: agent work states are unavailable; tree occupants are still shown.\n',
    )
  }
  return {
    ...identity,
    lineageQuota: { ...quota, nodes: undefined },
    tree: {
      occupants: quota.nodes.map(node => {
        const current = node.sessionId
          ? agents.find(agent => agent.sessionId === node.sessionId && agent.nodeId === node.nodeId)
          : undefined
        const action = spawnRecoveryAction(node)
        return {
          ...node,
          workState: {
            state: current?.state ?? 'unknown',
            quality: current?.quality ?? 'degraded',
            blockedReason: current?.blockedReason ?? null,
            turnId: current?.turn?.id ?? null,
          },
          actions: action ? [action] : [],
        }
      }),
    },
  }
}
type TreeIdentity = CallerIdentity & {
  tree?: {
    occupants: {
      nodeId: string
      title: string
      kind: string
      spawnedBy?: string | null
      workState: { state: string; blockedReason: string | null }
      actions: { command: string }[]
    }[]
  }
}
export function whoamiTreeText(value: unknown, context: TextOutputContext) {
  const result = value as TreeIdentity
  if (!result.tree || !context.io.stdout.isTTY || context.options.pretty) {
    return identityText(value, context)
  }
  const quota = result.lineageQuota!
  const rows = result.tree.occupants
  const visited = new Set<string>()
  const remaining = quota.remainingLiveInTree ?? Math.max(0, quota.maxLiveInTree - quota.liveInTree)
  const availability =
    quota.depth >= quota.maxDepth
      ? `0 more can start at your depth (${remaining} slots available)`
      : `${remaining} more can start`
  const lines = [
    `Agents: ${quota.liveInTree} of ${quota.maxLiveInTree} running in your tree; depth ${quota.depth} of ${quota.maxDepth}; ${availability}`,
  ]
  const append = (row: (typeof rows)[number], indent: number) => {
    if (visited.has(row.nodeId)) {
      return
    }
    visited.add(row.nodeId)
    const state =
      row.workState.state === 'waiting' && row.workState.blockedReason
        ? `waiting (${row.workState.blockedReason})`
        : row.workState.state
    const command =
      row.kind === 'terminal'
        ? `opencove node get --node ${shellWord(row.nodeId)} --fields sessionId; then opencove session kill --session <sessionId>`
        : row.actions.map(action => action.command).join('; ')
    lines.push(
      `${'  '.repeat(indent)}${safeTerminalText(row.title)} [${safeTerminalText(row.nodeId.slice(0, 12))}] ${safeTerminalText(state)} — ${safeTerminalText(command)}`,
    )
    rows.filter(child => child.spawnedBy === row.nodeId).forEach(child => append(child, indent + 1))
  }
  rows
    .filter(row => !rows.some(parent => parent.nodeId === row.spawnedBy))
    .forEach(row => append(row, 1))
  rows.forEach(row => append(row, 1))
  lines.push('Idle agents still occupy slots; check before stopping.')
  return lines.join('\n') + '\n'
}
