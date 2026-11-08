import { projectTaskLinks } from '../core/agentMetadata'
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
  'taskNodeId',
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
  'lastEndedTurn',
  'lastEndedTurn.id',
  'lastEndedTurn.outcome',
  'lastEndedTurn.endedAt',
]
const stateWaitRender = {
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
}

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
      'Returns {epoch, seq, agents}, one row per live agent session. Exited sessions are excluded by agent.list (so --state exited returns no rows); use agent get or wait for a known exited node. taskNodeId is the task whose linkedAgentNodeId points here (null if absent/ambiguous). Titles come from node metadata; null means unbound or deleted. turn.startedAt is epoch milliseconds, or absent when no turn is active. Inside OpenCove, the default scope is your space; --project selects a whole project.',
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
      const rows = await Promise.all(
        result.agents.map(async agent => ({
          agent,
          node: await nodeMetadata(ctx, agent.nodeId),
        })),
      )
      const projects = [
        ...new Set(
          rows.map(({ node }) => node?.projectId ?? (ctx.options.project as string | undefined)),
        ),
      ]
      const linksByProject = new Map(
        await Promise.all(
          projects.map(
            async projectId => [projectId, await projectTaskLinks(ctx, projectId)] as const,
          ),
        ),
      )
      return {
        ...result,
        agents: rows.map(({ agent, node }) => ({
          ...agent,
          lastEndedTurn: agent.lastEndedTurn ?? null,
          title: node?.title ?? null,
          taskNodeId: agent.nodeId
            ? (linksByProject
                .get(node?.projectId ?? (ctx.options.project as string | undefined))
                ?.get(agent.nodeId) ?? null)
            : null,
        })),
      }
    },
  }),
  defineCommand({
    path: ['agent', 'get'],
    connect: true,
    operation: 'agent.get',
    summary: 'Inspect an agent run-state snapshot with its node title',
    description:
      'Returns the Worker snapshot plus title and taskNodeId (reverse task-owned link, null if absent/ambiguous), including observed agents inside terminal nodes. A node without registered run state fails with agent.not_found (exit 1); use node get to inspect a terminal/note, or start/resume an agent window. State is runtime evidence, independent of persisted node status. Unknown/degraded is never ready. lastEndedTurn identifies the most recent ended turn with {id, outcome, endedAt} (epoch milliseconds), or null before any end in this incarnation. It persists while the next turn runs and resets on replacement/restart. turnOutcome keeps its legacy behavior: set on end (completed, failed, aborted or unknown), usually cleared on the next start; use lastEndedTurn for identity-bound results.',
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
      // Terminals can host an agent typed into their shell; other node kinds never have run state.
      if (node && node.kind !== 'agent' && (node.kind !== 'terminal' || snapshot === null)) {
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
      return {
        ...snapshot,
        taskNodeId: (await projectTaskLinks(ctx, node?.projectId)).get(nodeId) ?? null,
        lastEndedTurn: snapshot.lastEndedTurn ?? null,
        title: node?.title ?? null,
      }
    },
  }),
  defineCommand({
    path: ['agent', 'wait'],
    connect: true,
    usage:
      '--node <selector> (--turn <turnId> | --until idle|waiting|exited|turn-end [--node <selector> ...] [--any|--all]) [--timeout <duration>] [options]',
    summary: 'Wait until agents reach a state or finish a turn',
    description: [
      'Wait without sending input. After prompting, save turnId: prompt → delivery status → wait --turn <turnId> → read --turn <turnId> -o json. Never resend because waiting times out.',
      '--turn selects one exact turn on one node, conflicts with --until/--any, and waits through permission/question pauses and provider continuations. Ended results include outcome, state, durability and retained deliveryIds/promptIds. Every ended outcome exits 0: check outcome and reply before claiming success.',
      '--until waits for idle, waiting, exited or turn-end. Existing state matches immediately; idle requires no active turn and known, nondegraded state. turn-end observes an end after waiting starts. Multiple nodes use --all (default) or --any.',
      'Exit codes: 0 condition met; 1 unavailable history; 2 invalid input; 124 timeout (lastKnown on stderr); 130 interruption. Agents keep running. Retention, restart/remote limits and error recovery: opencove skill.',
      'deliveryIds are retained correlations of OpenCove deliveries with this turn, including refused or uncertain attempts. Membership proves neither submission nor consumption, and an empty list proves nothing either: delivery records live in memory only, are cleared when OpenCove restarts and expire 30 minutes after resolving; inspect each deliveryId with opencove agent delivery <id>. promptIds are the provider prompt IDs for this turn (Claude continuations included); agent delivery does not accept them.',
    ].join('\n\n'),
    options: {
      node: { ...stringOption('Node ID', true), multiple: true },
      until: {
        type: 'string',
        choices: ['idle', 'waiting', 'exited', 'turn-end'],
        conflicts: ['turn'],
        valueName: 'idle|waiting|exited|turn-end',
        description: 'Condition to observe',
      },
      turn: {
        ...stringOption('Exact OpenCove turn ID returned by agent prompt'),
        valueName: 'turnId',
        conflicts: ['until', 'any'],
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
      if (o.turn === undefined && o.until === undefined) {
        usage('Use exactly one of --turn or --until.')
      }
      if (
        o.turn !== undefined &&
        (String(o.turn).trim() === '' || (o.node as string[]).length !== 1 || o.any)
      ) {
        usage('--turn requires one nonempty turn ID, exactly one --node and no --any.')
      }
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
      ...stateWaitRender,
      fields: [
        ...stateWaitRender.fields!,
        'turnId',
        'deliveryIds',
        'promptIds',
        'outcome',
        'endedAt',
        'persisted',
        'memoryOnlyReason',
      ],
    },
    selectRender: ({ options: o }) =>
      o.turn !== undefined
        ? declaredOutput(
            [
              'nodeId',
              'sessionId',
              'turnId',
              'deliveryIds',
              'promptIds',
              'outcome',
              'endedAt',
              'persisted',
              'memoryOnlyReason',
              'state',
            ],
            {
              nodeId: 'node-123',
              sessionId: 'session-123',
              turnId: 'turn-123',
              outcome: 'completed',
              state: 'idle',
            },
          )
        : stateWaitRender,
    examples: [
      'opencove agent wait --node node-123 --turn turn-123 --timeout 2m',
      'opencove agent wait --node "Reviewer" --until idle --timeout 2m',
      'opencove agent wait --node node-123 --node node-456 --until waiting --any --timeout 30s',
    ],
    async execute(ctx) {
      return waitForAgents({
        nodeIds: ctx.options.node as string[],
        until: ctx.options.until as WaitUntil,
        turnId: ctx.options.turn as string | undefined,
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
