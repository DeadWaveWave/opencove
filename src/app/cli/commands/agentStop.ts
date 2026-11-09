import type { AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import type { GetNodeResult } from '../../../shared/contracts/dto/nodeControl'
import { defineCommand } from '../core/command'
import { CliError } from '../core/errors'
import { declaredOutput } from './declaredOutput'
import { stringOption } from './nodes'

function supportsAgentOnly(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return false
  }
  const value = schema as Record<string, unknown>
  const properties = value.properties as Record<string, unknown> | undefined
  const agentOnly = properties?.agentOnly as { const?: unknown } | undefined
  return (
    agentOnly?.const === true ||
    [value.anyOf, value.oneOf].some(
      branches => Array.isArray(branches) && branches.some(supportsAgentOnly),
    )
  )
}

export const agentStopCommand = defineCommand({
  path: ['agent', 'stop'],
  connect: true,
  mutation: true,
  operationAliases: ['session.stopNode'],
  summary: 'Stop the agent session bound to a canvas node',
  description: [
    'Stop an agent window, or a terminal that still hosts a live observed agent, while keeping the canvas node. A terminal’s entire session stops, including its shell. An exited agent is a no-op even if its shell is still running. Plain terminals are refused; use session kill --session <id> to stop a shell session.',
    'Returns {nodeId, sessionId, stopped: true} when the stop is requested. An already-exited session returns stopped: false and reason: not_running (exit 0). A changed node/session binding refuses the stop (exit 2); inspect the node again before deciding what to stop. Stopping never sends terminal input.',
  ].join('\n\n'),
  options: { node: stringOption('Node ID', true) },
  examples: ['opencove agent stop --node "Lead"'],
  render: declaredOutput(['nodeId', 'sessionId', 'stopped', 'reason'], {
    nodeId: 'node-123',
    sessionId: 'session-123',
    stopped: true,
  }),
  async execute(ctx) {
    const nodeId = String(ctx.options.node)
    const { node } = (await ctx.invoke('node.get', { nodeId }, { fresh: true })) as GetNodeResult
    if (node.kind === 'terminal') {
      const agent = (await ctx.invoke(
        'agent.get',
        { nodeId },
        { fresh: true },
      )) as AgentRunSnapshot | null
      if (agent && (agent.nodeId !== nodeId || agent.sessionId !== node.sessionId)) {
        throw new CliError(
          'common.invalid_input',
          2,
          'This window’s agent session changed before it could be stopped.',
          'Inspect the current session with "opencove node get --node <selector>" before deciding what to stop.',
        )
      }
      if (!agent) {
        throw new CliError(
          'agent.not_found',
          1,
          `${JSON.stringify(node.title)} has no observed agent in its current terminal session.`,
          'Use "opencove session kill --session <id>" to stop a plain terminal session.',
        )
      }
      if (agent.state === 'exited') {
        return { nodeId, sessionId: node.sessionId, stopped: false, reason: 'not_running' }
      }
    } else if (node.kind !== 'agent') {
      throw new CliError(
        'agent.not_found',
        1,
        `${JSON.stringify(node.title)} is not an agent or terminal window.`,
        'Use "opencove agent list" to find an agent to stop.',
      )
    }
    if (!node.sessionId) {
      throw new CliError(
        'session.not_found',
        1,
        `${JSON.stringify(node.title)} has no bound session.`,
        'Inspect the node with "opencove node get --node <selector>" before starting or resuming it.',
      )
    }
    const description = (await ctx.invoke('system.operation.describe', {
      id: 'session.stopNode',
    })) as { inputSchema?: unknown }
    if (!supportsAgentOnly(description.inputSchema)) {
      throw new CliError(
        'common.protocol_incompatible',
        5,
        'This Worker cannot safely stop an agent inside a terminal.',
        'Update the Worker to the same version as this CLI, then inspect the node before retrying.',
      )
    }
    const result = (await ctx.invoke('session.stopNode', {
      nodeId,
      sessionId: node.sessionId,
      agentOnly: true,
    })) as {
      stopped: boolean
      reason?: 'not_running'
    }
    return {
      nodeId,
      sessionId: node.sessionId,
      stopped: result.stopped,
      ...(result.reason ? { reason: result.reason } : {}),
    }
  },
})
