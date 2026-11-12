import { resolveSelectors } from '../core/selectors'
import { errorCandidates, errorRetryable } from '../core/errorPresentation'
import { presentReadAttention } from './agentReadAttention'
import { replayScreen } from '../core/screenReplay'
import { readAgentFinalMessage, type HookFinalMessage } from '../core/agentFinalMessage'
import { defineCommand, type CommandContext } from '../core/command'
import { presentAgentTurnError } from '../core/agentTurnError'
import { agentFinalMessageOperation } from '../../../shared/contracts/controlSurface/operations/domains/agent'
import { CliError, usage, validationError } from '../core/errors'
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
    'Read the latest ended reply, or exactly --turn <turnId>. Single-target output defaults to plain text; -o json includes outcome and durability. Exact reads never fall back to another turn or transcript.',
    'Loop: prompt → delivery status → wait --turn <turnId> → read --turn <turnId> -o json. Check outcome; never resend because reading fails. Local archived exact reads survive restart.',
    'Repeat --node for up to 10 targets: always a JSON array in input order, {node, ok, ...reply} or {node, ok:false, error}. Failures are independent. --turn requires one target; --expect-turn is unsupported; --last and screen options apply to all.',
    '--screen shows the visible terminal (last 40 lines); --scrollback adds history (last 200; --lines 1–5000). Both strip ANSI and never send input. Screen modes exclude each other and --last/--turn.',
    'deliveryIds are retained correlations, including refused or uncertain attempts, proving neither submission nor consumption: inspect each deliveryId with opencove agent delivery <id>. promptIds are the provider prompt IDs, not delivery IDs.',
    'Exit codes: 0 readable results; otherwise the first failing target’s exit (1 unavailable content; 2 invalid input; 4 authorization refusal). Fallback, correlation, truncation, retention and recovery: opencove skill read.',
  ].join('\n\n'),
  options: {
    node: { ...stringOption('Node ID (repeat for up to 10 targets)', true), multiple: true },
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
  resolveSelectorsInExecute: true,
  // Validate each read after isolating its selector; a batch is not one Worker request.
  serverValidation: true,
  buildInput: ({ options: o }) => {
    if ([o.node].flat().length > 10) {
      usage('agent read accepts at most 10 targets.')
    }
    if ([o.node].flat().length > 1 && o.turn !== undefined) {
      usage('--turn is only available with a single target.')
    }
    if (o.lines !== undefined && !o.screen && !o.scrollback) {
      usage('--lines requires --screen or --scrollback.')
    }
    if (o.lines !== undefined && (!Number.isSafeInteger(o.lines) || Number(o.lines) <= 0)) {
      usage('--lines must be a positive whole number.')
    }
    if (o.scrollback && Number(o.lines ?? 200) > 5000) {
      usage('--scrollback --lines must be between 1 and 5000.')
    }
    const input = {
      nodeId: [o.node].flat()[0],
      ...(o.turn !== undefined ? { turnId: o.turn } : {}),
    }
    if ([o.node].flat().length === 1) {
      const validation = agentFinalMessageOperation.input.safeParse(input)
      if (!validation.success) {
        throw validationError('agent.finalMessage', validation.error.issues, 2, 'cli.usage', input)
      }
      return agentFinalMessageOperation.normalize(validation.data)
    }
    return input
  },
  render: messageOutput,
  selectRender: ({ options }) => {
    const spec = options.screen || options.scrollback ? screenOutput : messageOutput
    return [options.node].flat().length > 1
      ? {
          ...spec,
          list: true,
          fields: [
            'node',
            'ok',
            'error',
            'error.code',
            'error.message',
            'error.hint',
            'error.details',
            'error.retryable',
            'error.candidates',
            ...spec.fields!,
          ],
        }
      : spec
  },
  exitCode: result =>
    Array.isArray(result) ? (result.find(entry => !entry.ok)?.error.exitCode ?? 0) : 0,
  examples: [
    'opencove agent read --node "Reviewer" --screen',
    'opencove agent read --node "Reviewer" --node "Lead"',
    'opencove agent read --node "Shell" --scrollback --lines 200',
    'opencove agent read --node "Reviewer" --screen --lines 20 -o json',
    'opencove agent read --node "Reviewer" --last',
    'opencove agent read --node node-123 --turn turn-123',
    'opencove agent read --node node-123 --turn turn-123 -o json',
  ],
  textOutput: result => {
    if (Array.isArray(result)) {
      return undefined
    }
    const value = result as ScreenResult | HookFinalMessage | GetSessionFinalMessageResult
    const text = 'lines' in value ? value.lines.join('\n') : (value.message ?? '')
    return text.endsWith('\n') || !text ? text : text + '\n'
  },
  async execute(ctx) {
    const targets = [ctx.options.node].flat() as string[]
    const read = async (selector: string) => {
      const target = { ...ctx, options: { ...ctx.options, node: selector } }
      await resolveSelectors(agentReadCommand, target, ctx.io, ctx.invoke)
      target.input = agentReadCommand.buildInput!(target)
      return readOne(target)
    }
    if (targets.length === 1) {
      return read(targets[0])
    }
    return Promise.all(
      targets.map(async node => {
        try {
          return { node, ok: true, ...(await read(node)) }
        } catch (cause) {
          const error =
            cause instanceof CliError
              ? cause
              : new CliError(
                  'cli.failed',
                  1,
                  cause instanceof Error ? cause.message : String(cause),
                )
          // Preserve the exit internally without adding fields to the public error shape.
          const publicError = {
            code: error.code,
            message: error.message,
            hint: error.hint,
            details: error.details,
            retryable: errorRetryable(error, true),
            candidates: errorCandidates(error),
          }
          Object.defineProperty(publicError, 'exitCode', { value: error.exitCode })
          return { node, ok: false, error: publicError }
        }
      }),
    )
  },
})

async function readOne(ctx: CommandContext) {
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
}
