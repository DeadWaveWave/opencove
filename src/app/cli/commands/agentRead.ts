import { presentReadAttention } from './agentReadAttention'
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
  const lines = replayScreen(snapshot, ctx.options.scrollback ? 5000 : 0)
  return {
    nodeId,
    sessionId: snapshot.sessionId,
    lines: lines.slice(-Number(ctx.options.lines ?? (ctx.options.scrollback ? 200 : 40))),
  }
}

export const agentReadCommand = defineCommand({
  path: ['agent', 'read'],
  connect: true,
  operation: 'agent.finalMessage',
  summary: 'Read an agent reply or inspect its current terminal screen',
  description: [
    'Read the latest ended reply, or exactly --turn <turnId> from agent prompt. Plain text is the default even when piped; -o json exposes outcome, durability and retained deliveryIds/promptIds. Exact reads never fall back to another turn or transcript.',
    'Loop: prompt → delivery status → wait --turn <turnId> → read --turn <turnId> -o json. Check outcome and reply; never resend because a read fails. Local archived exact reads survive restart. Claude and Codex lifecycle hooks supply exact-turn replies. Codex keeps the first matching Stop reply that ends the local turn; later continuation does not replace it.',
    '--screen shows the visible terminal (last 40 lines); --scrollback adds retained history (last 200; --lines 1–5000; none on the alternate screen). Both work for terminals and agent windows and strip ANSI. Inspect --screen for drafts/dialogs before prompting. Reading never sends input. --screen and --scrollback exclude each other and --last/--turn.',
    'Exit codes: 0 readable result (including empty content); 1 unavailable reply/transcript; 2 invalid input; 4 authentication or grant-policy refusal. Detailed fallback rules, truncation, retention and recovery: opencove skill read.',
    'deliveryIds are retained correlations of OpenCove deliveries with this turn, including refused or uncertain attempts. Membership proves neither submission nor consumption, and an empty list proves nothing either: delivery records live in memory only, are cleared when OpenCove restarts and expire 30 minutes after resolving; inspect each deliveryId with opencove agent delivery <id>. promptIds are the provider prompt IDs for this turn (Claude continuations included); agent delivery does not accept them.',
  ].join('\n\n'),
  options: {
    node: stringOption('Node ID', true),
    last: {
      type: 'boolean',
      conflicts: ['screen', 'scrollback'],
      description: 'Read the latest ended turn (default; --turn selects an exact turn)',
    },
    turn: {
      type: 'string',
      normalize: value => value.trim(),
      valueName: 'turnId',
      conflicts: ['screen', 'scrollback'],
      description: 'Read exactly this OpenCove turn ID from agent prompt; never falls back',
    },
    screen: {
      type: 'boolean',
      conflicts: ['last', 'turn', 'scrollback'],
      description: 'Inspect the current terminal screen as plain text instead of the final message',
    },
    scrollback: {
      type: 'boolean',
      conflicts: ['screen', 'last', 'turn'],
      description: 'Read retained terminal history and screen (default: 200 lines; maximum: 5000)',
    },
    lines: {
      type: 'number',
      valueName: 'n',
      description:
        'Return the last n rendered lines (positive integer; requires --screen or --scrollback)',
    },
  },
  buildInput: ({ options: o }) => {
    if (o.lines !== undefined && !o.screen && !o.scrollback) {
      usage('--lines requires --screen or --scrollback.')
    }
    if (o.lines !== undefined && (!Number.isSafeInteger(o.lines) || Number(o.lines) <= 0)) {
      usage('--lines must be a positive whole number.')
    }
    if (o.scrollback && Number(o.lines ?? 200) > 5000) {
      usage('--scrollback --lines must be between 1 and 5000.')
    }
    return { nodeId: o.node, ...(o.turn !== undefined ? { turnId: o.turn } : {}) }
  },
  render: messageOutput,
  selectRender: ({ options }) =>
    options.screen || options.scrollback ? screenOutput : messageOutput,
  examples: [
    'opencove agent read --node "Reviewer" --screen',
    'opencove agent read --node "Shell" --scrollback --lines 200',
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
      return ctx.options.screen || ctx.options.scrollback
        ? await readScreen(ctx)
        : await readAgentFinalMessage(ctx)
    } catch (error) {
      if (!(error instanceof CliError)) {
        throw error
      }
      if (['session.not_found', 'node.not_found'].includes(error.code)) {
        throw new CliError(
          error.code,
          1,
          ctx.options.screen || ctx.options.scrollback
            ? 'No current terminal screen was found for this node.'
            : 'No agent conversation was found for this node.',
          'Run opencove node list to check the selector, then start or resume its agent session before reading.',
          error.details,
        )
      }
      throw await presentReadAttention(
        presentAgentTurnError(error, {
          nodeId: String(ctx.options.node),
          turnId: ctx.options.turn as string | undefined,
        }),
        ctx,
      )
    }
  },
})
