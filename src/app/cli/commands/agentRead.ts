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
    'outcome',
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
    'Reads agent.finalMessage first: the latest observed ended turn, or exactly --turn <turnId> from agent prompt. --turn never uses prefixes, another turn or a transcript fallback. --last makes the latest-turn default explicit and can accompany --turn.',
    'Only an unqualified hook read reporting no_ended_turn or provider_sent_no_message falls back to session.finalMessage, including restored conversations. Other errors are preserved. Hook content, including empty or whitespace-only messages, wins. Exact-turn errors use agent.final_message_unavailable with details.reason: turn_not_ended (still active), turn_not_found (unknown/evicted), no_ended_turn, provider_sent_no_message, or remote_history_unavailable. CLI errors retain code/reason and include known nodeId/sessionId/turnId plus concrete recovery commands: wait for a running turn, inspect agent get for missing history, or inspect --screen/session final for unavailable content.',
    'Plain message text goes to stdout even when piped. -o json or --fields returns structured data: hook results have nodeId, sessionId, turnId, optional promptId, outcome, message, truncated and source: hook; transcript results have sessionId, provider, startedAt, cwd, resumeSessionId, message, truncated: false and source: transcript. A cut hook message prints one stderr notice with transcript/screen recovery commands; it never automatically replaces the retained prefix.',
    'Claude messages queued mid-turn continue the same OpenCove turn, including provider follow-ups. Exact reads return its final reply after all continuations. An unknown continuation outcome marks the last provider reply with messageKind: intermediate and prints a notice. After wait --until idle, read returns only the latest ended turn reply.',
    'After agent prompt, retain its turnId, run "opencove agent wait --node <selector> --turn <turnId>", then "opencove agent read --node <selector> --turn <turnId>". Hook history is private, in memory, and limited to the last 8 ended turns per incarnation; restart or replacement clears it. Remote wait --turn uses mirrored snapshots/events; older remote turns can only be checked on the Worker that runs them (remote_history_unavailable). Hook replies currently require local Claude hooks with correlated prompt IDs.',
    "Use --screen before prompting to inspect drafts and dialogs. It resolves the current session, replays its presentation snapshot at its columns/rows, preserving cursor-created spaces, overwrites and wide CJK/emoji cells. It selects the normal or alternate buffer, ignores styling/mode sequences, trims row-end spaces and trailing blank rows, then returns the last --lines rendered rows (default: 40). -o json returns {nodeId, sessionId, lines: [...]}. Screen-mode projectable fields are nodeId, sessionId, lines; the field list below applies to final-message mode. --lines requires --screen; --screen conflicts with --last and --turn. This is a read only snapshot, not permission to answer another agent's dialog.",
    'If transcript fallback has no readable message, session.transcript_not_ready exits 1. A working agent may need to reach idle first; an idle agent may have transcript saving disabled. Inspect --screen and check provider settings; waiting cannot create a transcript. Reading never sends input.',
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
