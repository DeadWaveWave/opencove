import { defineCommand } from '../core/command'
import { agentReadCommand } from './agentRead'
import { CliError, usage } from '../core/errors'
import { stringOption } from './nodes'
import { declaredOutput } from './declaredOutput'
import { waitForAgents, type WaitUntil } from '../core/agentWait'
import type { AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import type { GetNodeResult } from '../../../shared/contracts/dto/nodeControl'
import type { CommandContext } from '../core/command'

const runFields = [
  'nodeId',
  'title',
  'sessionId',
  'provider',
  'state',
  'blockedReason',
  'turn',
  'turn.id',
  'turn.startedAt',
  'turn.start',
  'lastTransitionAt',
  'source',
  'quality',
  'turnOutcome',
]
async function nodeMetadata(ctx: CommandContext, nodeId: string | null) {
  if (nodeId === null) {
    return null
  }
  try {
    return ((await ctx.invoke('node.get', { nodeId })) as GetNodeResult).node
  } catch (error) {
    // A concurrent node deletion must not hide the authoritative runtime snapshot.
    if (error instanceof CliError && error.code === 'node.not_found') {
      return null
    }
    throw error
  }
}
export const agentQueryCommands = [
  defineCommand({
    path: ['agent', 'list'],
    connect: true,
    operation: 'agent.list',
    summary: 'List live agent run states and node titles',
    description:
      'Returns {epoch, seq, agents}, one row per live agent session. Exited sessions are excluded by agent.list (so --state exited returns no rows); use agent get or wait for a known exited node. Titles come from node metadata; null means unbound or deleted. turn.startedAt is epoch milliseconds, or absent when no turn is active. Inside OpenCove, the default scope is your space; --project selects a whole project.',
    options: {
      space: stringOption('Space ID'),
      state: {
        type: 'string',
        choices: ['working', 'waiting', 'idle', 'exited', 'unknown'],
        valueName: 'working|waiting|idle|exited|unknown',
        description: 'Filter the authoritative run state',
      },
    },
    buildInput: ({ options: o }) => ({ spaceId: o.space, projectId: o.project, state: o.state }),
    render: {
      ...declaredOutput(
        runFields,
        { epoch: 'e', seq: 1, agents: [{ nodeId: 'node-123' }] },
        { listKey: 'agents' },
      ),
      columns: [
        'nodeId',
        'title',
        'provider',
        'state',
        'blockedReason',
        'turn.startedAt',
        'quality',
      ],
    },
    examples: [
      'opencove agent list -o table',
      'opencove agent list --space "Review" --state waiting --fields nodeId,title,state,blockedReason',
    ],
    async execute(ctx) {
      const result = (await ctx.invoke('agent.list', ctx.input)) as {
        epoch: string
        seq: number
        agents: AgentRunSnapshot[]
      }
      return {
        ...result,
        agents: await Promise.all(
          result.agents.map(async agent => ({
            ...agent,
            title: (await nodeMetadata(ctx, agent.nodeId))?.title ?? null,
          })),
        ),
      }
    },
  }),
  defineCommand({
    path: ['agent', 'get'],
    connect: true,
    operation: 'agent.get',
    summary: 'Inspect an agent run-state snapshot with its node title',
    description:
      'Returns the Worker snapshot plus title. A non-agent node or missing run state fails with agent.not_found (exit 1); use node get to inspect a terminal/note, or start/resume an agent window. State is runtime evidence, independent of persisted node status. Unknown/degraded is never ready. turnOutcome describes the last ended turn and may be failed, aborted or unknown.',
    options: { node: stringOption('Node ID', true) },
    buildInput: ({ options: o }) => ({ nodeId: o.node }),
    render: declaredOutput(runFields, { nodeId: 'node-123' }),
    examples: [
      'opencove agent get --node "Reviewer" --pretty',
      'opencove agent get --node @self --fields state,quality,turn',
    ],
    async execute(ctx) {
      const snapshot = (await ctx.invoke('agent.get', ctx.input)) as AgentRunSnapshot | null
      const nodeId = String(ctx.options.node)
      const node = await nodeMetadata(ctx, nodeId)
      if (node && node.kind !== 'agent') {
        throw new CliError(
          'agent.not_found',
          1,
          `${JSON.stringify(node.title)} is a ${node.kind}, not an agent window.`,
          'Use "opencove node get --node <selector>" to inspect this node, or "opencove agent list" to find agent windows.',
        )
      }
      if (snapshot === null) {
        throw new CliError(
          'agent.not_found',
          1,
          `${JSON.stringify(node?.title ?? nodeId)} has no registered agent run state.`,
          'Start or resume an agent window, then run "opencove agent list" to inspect its run state.',
        )
      }
      return { ...snapshot, title: node?.title ?? null }
    },
  }),
  defineCommand({
    path: ['agent', 'wait'],
    connect: true,
    usage:
      '--node <selector> [--node <selector> ...] --until idle|waiting|exited|turn-end [--any|--all] [--timeout <duration>] [options]',
    summary: 'Wait until agents reach a state or finish a turn',
    description: [
      'Waits without sending any input. A state that already holds counts immediately, so after "agent prompt" use --until idle: it returns as soon as the turn has ended, even if it ended before you started waiting. idle never accepts an unknown or degraded state.',
      '--until turn-end waits for a turn to finish after this command starts; use it only when you start waiting while the turn is still running. A finished turn is not necessarily a successful one: check turnOutcome (or endedTurnOutcome for turn-end).',
      'With several --node options, --all (default) waits until every agent matches and --any until the first one does. The result lists the latest state of every selected agent. Budgets below 250ms are rejected with usage exit 2 before connecting. On timeout (default 20s) it exits 124, prints the last known states on stderr and nothing on stdout; Ctrl-C exits 130. The agents keep running either way.',
    ].join('\n\n'),
    options: {
      node: { ...stringOption('Node ID', true), multiple: true },
      until: {
        type: 'string',
        choices: ['idle', 'waiting', 'exited', 'turn-end'],
        required: true,
        valueName: 'idle|waiting|exited|turn-end',
        description: 'Condition to observe',
      },
      any: {
        type: 'boolean',
        conflicts: ['all'],
        description: 'Resolve when any selected node matches',
      },
      all: {
        type: 'boolean',
        conflicts: ['any'],
        description: 'Resolve when all selected nodes match (default)',
      },
      timeout: {
        type: 'number',
        valueName: 'duration',
        description: 'Overall wait budget, e.g. 30s, 2m or 20000ms (default: 20s; minimum: 250ms)',
      },
    },
    buildInput: ({ options: o }) => {
      if (
        o.timeout !== undefined &&
        (!Number.isSafeInteger(o.timeout) ||
          Number(o.timeout) < 250 ||
          Number(o.timeout) > 2147483647)
      ) {
        usage(
          'Wait timeout must be whole milliseconds from 250ms (minimum) to 2147483647ms (about 24 days).',
        )
      }
    },
    render: {
      ...declaredOutput(
        runFields
          .filter(field => field !== 'title')
          .concat([
            'endedTurn',
            'endedTurn.id',
            'endedTurn.startedAt',
            'endedTurn.start',
            'endedTurnOutcome',
          ]),
        { until: 'idle', mode: 'all', agents: [{ nodeId: 'node-123' }] },
        { listKey: 'agents' },
      ),
      examples: [
        'opencove agent wait --node node-123 --until idle --fields nodeId,state',
        '{"until":"idle","mode":"all","agents":[{"nodeId":"node-123","state":"idle"}]}',
      ],
    },
    examples: [
      'opencove agent wait --node "Reviewer" --until idle --timeout 2m',
      'opencove agent wait --node node-123 --node node-456 --until waiting --any --timeout 30s',
    ],
    async execute(ctx) {
      return waitForAgents({
        nodeIds: ctx.options.node as string[],
        until: ctx.options.until as WaitUntil,
        any: ctx.options.any === true,
        timeoutMs: Number(ctx.options.timeout ?? 20000),
        connection: ctx.connection!,
        fetch: ctx.io.fetch,
        signal: ctx.io.signal,
        query: (id, payload, signal) => ctx.invoke(id, payload, { fresh: true, signal }),
      })
    },
  }),
  agentReadCommand,
]
