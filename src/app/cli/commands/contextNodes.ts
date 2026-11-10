import type { CanvasNodeSummaryDto, GetNodeResult } from '../../../shared/contracts/dto/nodeControl'
import { nodeAgentMetadata } from '../core/agentMetadata'
import type { CommandContext } from '../core/command'
import { CliError } from '../core/errors'
import type { CallerIdentity } from '../core/identity'

type ContextNode = Awaited<ReturnType<typeof nodeAgentMetadata>>[number]
export function contextNodeSummary(node: ContextNode) {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    state:
      node.kind === 'task'
        ? (node.data?.status ?? null)
        : node.kind === 'agent'
          ? (node.agentState?.state ?? 'unknown')
          : node.kind === 'terminal'
            ? (node.status ?? null)
            : null,
    ...(node.sessionStatus !== undefined ? { sessionStatus: node.sessionStatus } : {}),
    ...(node.agentState ? { agentState: node.agentState } : {}),
    ...(node.taskNodeId !== undefined ? { taskNodeId: node.taskNodeId } : {}),
  }
}

export async function contextSelf(
  identity: CallerIdentity | undefined,
  nodes: CanvasNodeSummaryDto[],
  ctx: Pick<CommandContext, 'invoke' | 'io' | 'options'>,
) {
  if (!identity) {
    return null
  }
  const fields =
    ctx.options.fields === undefined
      ? undefined
      : String(ctx.options.fields)
          .split(',')
          .map(f => f.trim())
  if (
    fields &&
    !fields.some(f => f === 'self' || f === 'self.node' || f.startsWith('self.node.'))
  ) {
    return identity
  }
  let node = nodes.find(candidate => candidate.id === identity.nodeId)
  if (!node && identity.nodeId) {
    try {
      node = ((await ctx.invoke('node.get', { nodeId: identity.nodeId })) as GetNodeResult).node
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== 'node.not_found') {
        throw error
      }
    }
  }
  if (!node) {
    return { ...identity, node: null }
  }
  const [enriched] = await nodeAgentMetadata(
    [node],
    {
      ...ctx,
      options: {
        ...ctx.options,
        fields:
          fields === undefined || fields.some(f => ['self', 'self.node'].includes(f))
            ? undefined
            : fields
                .filter(f => f.startsWith('self.node.'))
                .map(f => f.replace(/^self\.node\./, 'nodes.'))
                .join(','),
      },
    },
    { projectId: node.projectId, spaceId: node.spaceId },
    true,
  )
  return { ...identity, node: contextNodeSummary(enriched) }
}
