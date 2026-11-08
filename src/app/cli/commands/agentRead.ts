import { replayScreen } from '../core/screenReplay'
import { readAgentFinalMessage, type HookFinalMessage } from '../core/agentFinalMessage'
import { defineCommand, type CommandContext } from '../core/command'
import { presentAgentTurnError } from '../core/agentTurnError'
import { CliError, usage } from '../core/errors'
import { stringOption } from './nodes'
import { declaredOutput } from './declaredOutput'
import type {
  GetNodeSessionResult,
  GetSessionFinalMessageResult,
  GetSessionPresentationSnapshotResult,
} from '../../../shared/contracts/dto/controlSurface'

const messageOutput = declaredOutput(
  [
    'nodeId',
    'sessionId',
    'turnId',
    'promptId',
    'deliveryIds',
    'promptIds',
    'outcome',
    'persisted',
    'memoryOnlyReason',
    'message',
    'messageKind',
    'truncated',
    'source',
    'provider',
    'startedAt',
    'cwd',
    'resumeSessionId',
  ],
  { nodeId: 'node-123' },
)
const screenOutput = declaredOutput(['nodeId', 'sessionId', 'lines'], {
  nodeId: 'node-123',
  sessionId: 's',
  lines: ['Ready'],
})
interface ScreenResult {
  nodeId: string
  sessionId: string
  lines: string[]
}

async function readScreen(ctx: CommandContext): Promise<ScreenResult> {
  const nodeId = String(ctx.options.node)
  const session = (await ctx.invoke('session.get', { nodeId })) as GetNodeSessionResult
  const snapshot = (await ctx.invoke('session.presentationSnapshot', {
    sessionId: session.sessionId,
  })) as GetSessionPresentationSnapshotResult
  const lines = replayScreen(snapshot)
  return {
    nodeId,
    sessionId: snapshot.sessionId,
    lines: lines.slice(-Number(ctx.options.lines ?? 40)),
  }
}

export const agentReadCommand = defineCommand({
  path: ['agent', 'read'],
  connect: true,
  operation: 'agent.finalMessage',
  summary: 'Read an agent reply or inspect its current terminal screen',
  description: [
    'Read the latest ended reply, or exactly --turn <turnId> from agent prompt. Plain text is the default even when piped; -o json exposes outcome, durability and retained deliveryIds/promptIds. Exact reads never fall back to another turn or transcript.',
    'Loop: prompt → delivery status → wait --turn <turnId> → read --turn <turnId> -o json. Check outcome and reply; never resend because a read fails. Local archived exact reads survive restart. Claude continuations share one OpenCove turn; Codex reply reads remain uncorrelated.',
    '--screen inspects the current terminal (last 40 rendered lines); --lines requires --screen. Use it before prompting to inspect drafts/dialogs. Reading never sends input. --screen conflicts with --last/--turn; --last makes the latest-turn default explicit.',
    'Exit codes: 0 readable result (including empty content); 1 unavailable reply/transcript; 2 invalid input. Detailed fallback rules, truncation, retention and recovery: opencove skill.',
    'deliveryIds are retained correlations of OpenCove deliveries with this turn, including refused or uncertain attempts. Membership proves neither submission nor consumption, and an empty list proves nothing either: delivery records live in memory only, are cleared when OpenCove restarts and expire 30 minutes after resolving; inspect each deliveryId with opencove agent delivery <id>. promptIds are the provider prompt IDs for this turn (Claude continuations included); agent delivery does not accept them.',
  ].join('\n\n'),
  options: {
    node: stringOption('Node ID', true),
    last: {
      type: 'boolean',
      conflicts: ['screen'],
      description: 'Read the latest ended turn (default; --turn selects an exact turn)',
    },
    turn: {
      type: 'string',
      valueName: 'turnId',
      conflicts: ['screen'],
      description: 'Read exactly this OpenCove turn ID from agent prompt; never falls back',
    },
    screen: {
      type: 'boolean',
      conflicts: ['last', 'turn'],
      description: 'Inspect the current terminal screen as plain text instead of the final message',
    },
    lines: {
      type: 'number',
      valueName: 'n',
      description:
        'Return the last n screen lines after trimming trailing blank lines (positive integer; default: 40; requires --screen)',
    },
  },
  buildInput: ({ options: o }) => {
    if (o.lines !== undefined && !o.screen) {
      usage('--lines requires --screen.')
    }
    if (o.lines !== undefined && (!Number.isSafeInteger(o.lines) || Number(o.lines) <= 0)) {
      usage('--lines must be a positive whole number.')
    }
    return { nodeId: o.node, ...(o.turn !== undefined ? { turnId: o.turn } : {}) }
  },
  render: messageOutput,
  selectRender: ({ options }) => (options.screen ? screenOutput : messageOutput),
  examples: [
    'opencove agent read --node "Reviewer" --screen',
    'opencove agent read --node "Reviewer" --screen --lines 20 -o json',
    'opencove agent read --node "Reviewer" --last',
    'opencove agent read --node node-123 --turn turn-123',
    'opencove agent read --node node-123 --turn turn-123 -o json',
  ],
  textOutput: result => {
    const value = result as ScreenResult | HookFinalMessage | GetSessionFinalMessageResult
    const text = 'lines' in value ? value.lines.join('\n') : (value.message ?? '')
    return text.endsWith('\n') || !text ? text : text + '\n'
  },
  async execute(ctx) {
    try {
      return ctx.options.screen ? await readScreen(ctx) : await readAgentFinalMessage(ctx)
    } catch (error) {
      if (!(error instanceof CliError)) {
        throw error
      }
      if (['session.not_found', 'node.not_found'].includes(error.code)) {
        throw new CliError(
          error.code,
          1,
          ctx.options.screen
            ? 'No current terminal screen was found for this node.'
            : 'No agent conversation was found for this node.',
          'Run opencove node list to check the selector, then start or resume its agent session before reading.',
          error.details,
        )
      }
      throw presentAgentTurnError(error, {
        nodeId: String(ctx.options.node),
        turnId: ctx.options.turn as string | undefined,
      })
    }
  },
})
