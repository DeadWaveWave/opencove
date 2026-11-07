import { replayScreen } from '../core/screenReplay'
import { readFinalMessage } from '../core/finalMessage'
import { defineCommand, type CommandContext } from '../core/command'
import { CliError, usage } from '../core/errors'
import { stringOption } from './nodes'
import { declaredOutput } from './declaredOutput'
import type {
  GetNodeSessionResult,
  GetSessionFinalMessageResult,
  GetSessionPresentationSnapshotResult,
} from '../../../shared/contracts/dto/controlSurface'

const transcriptOutput = declaredOutput(
  ['sessionId', 'provider', 'startedAt', 'cwd', 'resumeSessionId', 'message'],
  { sessionId: 's' },
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
  operation: 'session.finalMessage',
  summary: 'Read an agent reply or inspect its current terminal screen',
  description: [
    'By default, reads the last final message using session.finalMessage {nodeId}, including restored conversations. --last makes that default explicit. A null, empty or whitespace-only reply exits 1 with session.transcript_not_ready and the same recovery as session final; the server has no distinct empty-reply marker. Plain text goes to stdout even when piped; -o json returns {sessionId, provider, startedAt, cwd, resumeSessionId, message}. --fields also selects structured JSON.',
    "Use --screen before prompting to inspect drafts and dialogs. It resolves the current session, replays its presentation snapshot at its columns/rows, preserving cursor-created spaces, overwrites and wide CJK/emoji cells. It selects the normal or alternate buffer, ignores styling/mode sequences, trims row-end spaces and trailing blank rows, then returns the last --lines rendered rows (default: 40). -o json returns {nodeId, sessionId, lines: [...]}. Screen-mode projectable fields are nodeId, sessionId, lines; the field list below applies to transcript mode. --lines requires --screen; --screen and --last are mutually exclusive. This is a read only snapshot, not permission to answer another agent's dialog.",
    'If a completed idle agent has no readable transcript (for example transcript saving is disabled), inspect --screen and check provider settings; waiting cannot create that transcript. A working agent may need to reach idle first. Reading never sends input.',
  ].join('\n\n'),
  options: {
    node: stringOption('Node ID', true),
    last: {
      type: 'boolean',
      conflicts: ['screen'],
      description: 'Read the last final message (default; no transcript history)',
    },
    screen: {
      type: 'boolean',
      conflicts: ['last'],
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
    return { nodeId: o.node }
  },
  render: transcriptOutput,
  selectRender: ({ options }) => (options.screen ? screenOutput : transcriptOutput),
  examples: [
    'opencove agent read --node "Reviewer" --screen',
    'opencove agent read --node "Reviewer" --screen --lines 20 -o json',
    'opencove agent read --node "Reviewer" --last',
    'opencove agent read --node node-123 -o json',
  ],
  textOutput: result => {
    const value = result as ScreenResult | GetSessionFinalMessageResult
    const text = 'lines' in value ? value.lines.join('\n') : (value.message ?? '')
    return text.endsWith('\n') || !text ? text : text + '\n'
  },
  async execute(ctx) {
    try {
      return ctx.options.screen ? await readScreen(ctx) : await readFinalMessage(ctx)
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
      throw error
    }
  },
})
