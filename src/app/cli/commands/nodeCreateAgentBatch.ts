import * as z from 'zod'
import type { CommandArgs, CommandContext, TextOutputContext } from '../core/command'
import type { CliIo } from '../core/io'
import type { CreateNodeResult } from '../../../shared/contracts/dto/nodeControl'
import { CliError, printError, usage } from '../core/errors'
import { safeTerminalText } from '../core/errorPresentation'
import { assertProviderInitialPrompt } from '../../../shared/utils/providerInitialPromptPolicy'
import {
  assertSessionGrantLaunchPrompt,
  assertSessionGrantMessagePrompt,
} from '../../../shared/utils/grantInitialPromptPolicy'
import {
  isSelectableAgentProvider,
  SELECTABLE_AGENT_PROVIDERS,
} from '../../../shared/contracts/agentProviderSelection'
import { formatAppErrorMessage, toAppErrorDescriptor } from '../../../shared/errors/appError'
import { applyNodeMutation } from './nodeMutation'
import { createdAgentWaitDeadline, waitForCreatedAgent } from './nodeCreateAgentWait'

const entriesSchema = z
  .array(
    z.strictObject({
      prompt: z.string().refine(s => s.trim().length > 0),
      title: z.string().optional(),
    }),
  )
  .min(1)
  .max(10)
interface PreparedBatch {
  entries: z.infer<typeof entriesSchema>
}

export async function prepareAgentBatch({ options }: CommandArgs, io: CliIo) {
  if (options['prompts-file'] === undefined) {
    return
  }
  if (!options.wait) {
    usage('--prompts-file requires --wait.')
  }
  for (const key of ['prompt', 'title', 'task', 'frame', 'quiet', 'fields', 'focus', 'limit']) {
    if (options[key] !== undefined) {
      usage(`--prompts-file cannot be combined with --${key}.`)
    }
  }
  let text: string
  try {
    text =
      options['prompts-file'] === '-'
        ? await io.readStdinText()
        : await io.readTextFile(String(options['prompts-file']))
  } catch (error) {
    if (error instanceof CliError && error.exitCode === 130) {
      throw error
    }
    usage('Could not read --prompts-file. Check the file path and permissions, or use - for stdin.')
  }
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
    usage('--prompts-file must be at most 1 MiB of UTF-8 JSON.')
  }
  let value: unknown
  try {
    value = JSON.parse(text.startsWith('\uFEFF') ? text.slice(1) : text)
  } catch {
    usage(
      '--prompts-file must contain a JSON array of 1–10 objects with prompt and optional title.',
    )
  }
  const parsed = entriesSchema.safeParse(value)
  if (!parsed.success) {
    usage(
      '--prompts-file must contain 1–10 objects with a non-empty prompt and optional string title; other keys are not allowed.',
    )
  }
  validateBatchPrompts(parsed.data, options.provider)
  return { entries: parsed.data } satisfies PreparedBatch
}

/** Omitted/legacy providers resolve from private Settings: do not guess that value. */
function launchProviders(requested: unknown) {
  return isSelectableAgentProvider(requested) ? [requested] : SELECTABLE_AGENT_PROVIDERS
}
class BatchPromptValidationError extends CliError {
  constructor(message: string) {
    super('cli.usage', 2, message)
  }
}
function validateBatchPrompts(entries: PreparedBatch['entries'], provider: unknown, grant = false) {
  try {
    for (const entry of entries) {
      if (grant) {
        assertSessionGrantLaunchPrompt(entry.prompt.trim(), 'node.create')
      }
      for (const candidate of launchProviders(provider)) {
        if (grant) {
          assertSessionGrantMessagePrompt(entry.prompt, {
            provider: candidate,
            operationId: 'node.create',
            field: 'prompt',
          })
        }
        assertProviderInitialPrompt(candidate, entry.prompt)
      }
    }
  } catch (error) {
    throw new BatchPromptValidationError(formatAppErrorMessage(toAppErrorDescriptor(error)))
  }
}

function failure(io: CliIo, cause: unknown, createAttempted: boolean) {
  const error =
    cause instanceof CliError
      ? cause
      : new CliError('cli.failed', 1, cause instanceof Error ? cause.message : String(cause))
  let text = ''
  printError(
    {
      ...io,
      stderr: {
        write: s => {
          text += s
        },
      },
    },
    error,
    true,
    !createAttempted,
  )
  return {
    ok: false as const,
    exitCode: error.exitCode,
    error: JSON.parse(text) as {
      error: { code: string; message: string; hint?: string; details?: { nodeId?: string } }
    },
  }
}
type BatchEntry = { index: number; title: string | null } & (
  | { ok: true; exitCode: number; result: Awaited<ReturnType<typeof waitForCreatedAgent>> }
  | ReturnType<typeof failure>
)

interface BatchResult {
  entries: BatchEntry[]
  interrupted: boolean
}
export async function createAgentBatch(ctx: CommandContext): Promise<BatchResult> {
  const { entries } = ctx.prepared as PreparedBatch
  const caller = await ctx.whoami()
  validateBatchPrompts(entries, ctx.options.provider, caller.caller === 'session-grant')
  const pending: Promise<BatchEntry>[] = []
  for (const [index, entry] of entries.entries()) {
    const label = { index, title: entry.title ?? null }
    if (ctx.io.signal?.aborted) {
      pending.push(
        Promise.resolve({
          ...label,
          ...failure(
            ctx.io,
            new CliError('cli.interrupted', 130, 'Interrupted before this entry was launched.'),
            false,
          ),
        }),
      )
      continue
    }
    let createAttempted = false
    const input = ctx.input as { data: object }
    const target = {
      ...ctx,
      options: { ...ctx.options, prompt: entry.prompt, title: entry.title },
      input: { ...input, title: entry.title, data: { ...input.data, prompt: entry.prompt } },
    }
    try {
      // Only creation is sequential. The unchanged single-agent observer starts immediately.
      // eslint-disable-next-line no-await-in-loop
      const created = (await applyNodeMutation(target, 'agent', true, () => {
        createAttempted = true
      })) as CreateNodeResult
      pending.push(
        waitForCreatedAgent(target, created, createdAgentWaitDeadline(target)).then(
          result => ({ ...label, ok: true as const, exitCode: 0, result }),
          error => ({ ...label, ...failure(ctx.io, error, createAttempted) }),
        ),
      )
    } catch (error) {
      pending.push(Promise.resolve({ ...label, ...failure(ctx.io, error, createAttempted) }))
    }
  }
  return { entries: await Promise.all(pending), interrupted: ctx.io.signal?.aborted === true }
}
/** Before any create attempt, retain validated inputs on runtime preflight failures. */
export function recoverAgentBatchPreflight(
  error: unknown,
  { prepared, io }: CommandArgs & { prepared: unknown; io: CliIo },
): BatchResult | undefined {
  if (!prepared) {
    return undefined
  }
  const interrupted =
    io.signal?.aborted === true || (error instanceof CliError && error.exitCode === 130)
  // Prompt validation remains global; selector/configuration usage errors belong to the entries.
  if (!interrupted && error instanceof BatchPromptValidationError) {
    return undefined
  }
  const cause = interrupted
    ? new CliError('cli.interrupted', 130, 'Interrupted before this entry was launched.')
    : error
  const { entries } = prepared as PreparedBatch
  return {
    entries: entries.map((entry, index) => ({
      index,
      title: entry.title ?? null,
      ...failure(io, cause, false),
    })),
    interrupted,
  }
}
function isBatchResult(result: unknown): result is BatchResult {
  return (
    !!result &&
    typeof result === 'object' &&
    'entries' in result &&
    Array.isArray(result.entries) &&
    'interrupted' in result &&
    typeof result.interrupted === 'boolean'
  )
}
export function agentBatchOutput(result: unknown) {
  return isBatchResult(result) ? result.entries : result
}
export function agentBatchExitCode(result: unknown) {
  if (!isBatchResult(result)) {
    return 0
  }
  return result.interrupted
    ? 130
    : (result.entries.find(entry => entry.exitCode !== 0)?.exitCode ?? 0)
}
export function agentBatchText(
  result: unknown,
  { io, options }: TextOutputContext,
): string | undefined {
  if (!Array.isArray(result) || !io.stdout.isTTY || options.pretty) {
    return undefined
  }
  const entries = result as BatchEntry[]
  const summary = entries.map(
    entry =>
      `${entry.index + 1}  ${safeTerminalText(entry.title ?? '(automatic title)')}  ${safeTerminalText(entry.ok ? entry.result.node.id : (entry.error.error.details?.nodeId ?? '—'))}  ${safeTerminalText(entry.ok ? entry.result.outcome : entry.error.error.code)}  exit ${entry.exitCode}`,
  )
  const replies = entries.flatMap(entry =>
    entry.ok && 'reply' in entry.result && typeof entry.result.reply?.message === 'string'
      ? [
          `\n${entry.index + 1}  ${safeTerminalText(entry.title ?? '(automatic title)')}\n${entry.result.reply.message.split('\n').map(safeTerminalText).join('\n')}`,
        ]
      : [],
  )
  const errors = entries.flatMap(entry =>
    entry.ok
      ? []
      : [
          `\n${entry.index + 1}  ${safeTerminalText(entry.error.error.message)}${entry.error.error.hint ? '\n' + safeTerminalText(entry.error.error.hint) : ''}`,
        ],
  )
  return [...summary, ...replies, ...errors].join('\n') + '\n'
}
