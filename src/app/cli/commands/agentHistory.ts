import { defineCommand } from '../core/command'
import { CliError } from '../core/errors'
import { stringOption } from './nodes'
import { declaredOutput } from './declaredOutput'

export const agentHistoryClearCommand = defineCommand({
  path: ['agent', 'history', 'clear'],
  connect: true,
  mutation: true,
  operation: 'agent.history.clear',
  summary: 'Delete a node’s stored OpenCove replies without deleting the node',
  description: [
    'Deletes this node’s stored ended-turn replies from the Worker archive and in-memory history across all retained incarnations. Does not delete the node, provider transcripts or backups, and does not change run state, active turns or delivery records. A turn that ends after the clear is stored normally.',
    'Returns nodeId, memoryRemoved and archive: {status: cleared, removed}. Counts are per store; the same reply may have a copy in each. Repeating the command succeeds with zero counts. Requires interact scope. If the archive is unavailable, memory is still cleared; exits 1 with archive: {status: unavailable} and memoryRemoved in the error details, without claiming archive deletion. For an agent on a remote Worker it clears only local copies and exits 1 with details.reason: remote_history_unavailable.',
  ].join('\n\n'),
  options: { node: stringOption('Node ID', true) },
  buildInput: ({ options }) => ({ nodeId: options.node }),
  render: declaredOutput(
    ['nodeId', 'memoryRemoved', 'archive', 'archive.status', 'archive.removed'],
    {
      nodeId: 'node-123',
      memoryRemoved: 2,
      archive: { status: 'cleared', removed: 3 },
    },
  ),
  examples: ['opencove agent history clear --node "Reviewer"'],
  async execute(ctx) {
    try {
      return await ctx.invoke('agent.history.clear', ctx.input)
    } catch (error) {
      if (error instanceof CliError && error.code === 'common.unavailable') {
        const details = error.details as { reason?: string; memoryRemoved?: number } | undefined
        if (details?.reason === 'remote_history_unavailable') {
          throw new CliError(
            error.code,
            1,
            `Removed ${details.memoryRemoved ?? 0} local records; this agent runs on a remote Worker, whose stored replies were not cleared.`,
            'Run the clear against the Worker that runs this agent.',
            error.details,
          )
        }
        if (details?.reason === 'archive_unavailable') {
          throw new CliError(
            error.code,
            1,
            `Removed ${details.memoryRemoved ?? 0} in-memory records; archive unavailable, stored archive replies could not be cleared.`,
            'Restore archive access and retry the clear; provider transcripts and backups are unchanged.',
            error.details,
          )
        }
      }
      throw error
    }
  },
})
