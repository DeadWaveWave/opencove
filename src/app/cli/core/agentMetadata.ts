import { CliError } from './errors'
import type { AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import type {
  CanvasNodeSummaryDto,
  ListNodesResult,
} from '../../../shared/contracts/dto/nodeControl'
import type { CommandContext } from './command'

export const agentMetadataFields = [
  'sessionStatus',
  'agentState',
  'agentState.state',
  'agentState.quality',
  'agentState.turnId',
]

/** Read-only join: task ownership is always the task's forward pointer. */
export function taskLinks(nodes: CanvasNodeSummaryDto[]): Map<string, string | null> {
  const links = new Map<string, string | null>()
  for (const node of nodes) {
    const id = node.kind === 'task' ? node.data?.linkedAgentNodeId : null
    if (id) {
      links.set(id, links.has(id) ? null : node.id)
    }
  }
  return links
}

export async function projectTaskLinks(ctx: Pick<CommandContext, 'invoke'>, projectId?: string) {
  const result = (await ctx.invoke('node.list', {
    ...(projectId ? { projectId } : {}),
    kind: 'task',
  })) as ListNodesResult
  return taskLinks(result.nodes)
}

/** Explicit projections request only the observations/links they can display. */
function selected(fields: unknown, names: string[], context: boolean): boolean {
  if (fields === undefined) {
    return true
  }
  return String(fields)
    .split(',')
    .some(field => {
      const path = field.trim()
      if (context && path === 'nodes') {
        return true
      }
      const relative = path.replace(/^nodes\./, '')
      return names.some(name => relative === name || relative.startsWith(name + '.'))
    })
}

export async function nodeAgentMetadata(
  nodes: CanvasNodeSummaryDto[],
  ctx: Pick<CommandContext, 'invoke' | 'io' | 'options'>,
  scope: { projectId?: string | null; spaceId?: string | null },
  context = false,
) {
  const states = new Map<string | null, AgentRunSnapshot>()
  let links = new Map<string, string | null>()
  const failures: string[] = []
  if (nodes.some(node => node.kind === 'agent' || node.kind === 'terminal')) {
    await Promise.all([
      (async () => {
        if (
          !selected(ctx.options.fields, context ? ['agentState', 'state'] : ['agentState'], context)
        ) {
          return
        }
        try {
          const result = (await ctx.invoke('agent.list', {
            ...(scope.projectId && !scope.spaceId ? { projectId: scope.projectId } : {}),
            ...(scope.spaceId ? { spaceId: scope.spaceId } : {}),
          })) as { agents: AgentRunSnapshot[] }
          for (const agent of result.agents) {
            states.set(agent.nodeId, agent)
          }
        } catch (error) {
          if (error instanceof CliError && error.exitCode === 130) {
            throw error
          }
          states.clear()
          failures.push('agent state unavailable')
        }
      })(),
      (async () => {
        if (!selected(ctx.options.fields, ['taskNodeId'], context)) {
          return
        }
        try {
          links = await projectTaskLinks(ctx, scope.projectId ?? nodes[0]?.projectId)
        } catch (error) {
          if (error instanceof CliError && error.exitCode === 130) {
            throw error
          }
          failures.push('task links unavailable')
        }
      })(),
    ])
  }
  if (failures.length) {
    ctx.io.stderr.write(
      `Notice: ${failures.join('; ')}; optional metadata omitted or unknown/degraded.\n`,
    )
  }
  return nodes.map(node => {
    const snapshot = states.get(node.id)
    // A stale session's observation must not be projected onto a replacement session.
    const current =
      snapshot && (!node.sessionId || snapshot.sessionId === node.sessionId) ? snapshot : undefined
    return {
      ...node,
      ...(node.kind === 'agent' || node.kind === 'terminal'
        ? { sessionStatus: node.status ?? null, taskNodeId: links.get(node.id) ?? null }
        : {}),
      ...(node.kind === 'agent' || (node.kind === 'terminal' && current)
        ? {
            agentState: {
              state: current?.state ?? 'unknown',
              quality: current?.quality ?? 'degraded',
              turnId: current?.turn?.id ?? null,
            },
          }
        : {}),
    }
  })
}
