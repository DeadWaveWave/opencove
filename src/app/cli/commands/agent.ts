import { defineCommand } from '../core/command'
import { CliError, usage } from '../core/errors'
import { stringOption } from './nodes'
import { declaredOutput } from './declaredOutput'
import { canonicalizePromptText } from '../../../contexts/agent/domain/promptText'
import { toAppErrorDescriptor } from '../../../shared/errors/appError'
import { promptValidationPresentation } from '../../../shared/errors/agentPromptError'

export const agentPromptCommand = defineCommand({
  path: ['agent', 'prompt'],
  connect: true,
  operation: 'agent.prompt',
  usage: '--node <id> (--text <text> | --text-file <path|->) [options]',
  summary: 'Send a prompt to an agent window OpenCove launched',
  description: [
    'Prompting works only for agent windows OpenCove launched from tasks, the agent launcher, or node create agent. Agents typed into terminal shells (including shim/launcher invocations) are unsupported for both Claude Code and Codex. Option-like model/session values have no verified lifecycle coverage.',
    'Supported providers: local Claude Code with installed lifecycle hooks (Stop or StopFailure); local Codex with trusted lifecycle hooks for this invocation (Stop). Both require the default executable path (no override in Settings → agent executable), reliable hook idle, no active turn, and bracketed paste. Custom executable paths refuse with executable_override_unverified; remove the override and launch a new agent window. Codex notify-only, daemon reuse, file-only telemetry and Windows are unsupported.',
    'The agent must have finished a turn that OpenCove observed. This command refuses while the agent is working, waiting for input, or not known to be ready. Use exactly one text source; --text-file - reads stdin. Text must be valid Unicode, nonblank and at most 32 KiB in UTF-8 before newline normalization; trailing newlines are removed.',
    'This attempts to paste into the current editor; any existing draft may be submitted with it. Run "opencove agent read --node <selector> --screen" to check for drafts and dialogs first: unseen dialogs, including one-time settings notices, may consume the input.',
    'Success (submission_observed) means the provider reported a newly submitted prompt after this Enter. It does not prove the model read exactly this text, and the turn may still be running: wait for it with "opencove agent wait --node <selector> --until idle". The exact checks and their trust limits are in docs/agent/PROMPT_DELIVERY.md.',
    'textComparison is matched, different, or unavailable. claude-code-v1 compares equality modulo newline representation and trailing ASCII whitespace (space, tab, LF), verified for Claude Code 2.1.319; leading and interior whitespace remain significant. Codex comparison is unavailable until a profile is verified. Optional promptId is diagnostic, not turn correlation. Different is uncertainty and still exits 0: stop automatic orchestration, inspect with opencove agent read --node <id> --screen, and never resend or press Enter again because of the comparison.',
    'This command never retries automatically. After an interrupted or uncertain delivery, inspect the terminal with "opencove agent read --node <selector> --screen" and read the conversation. Do not resend a prompt that may already have been submitted.',
    'Exit codes: 0 submission observed; 1 refused or delivery unconfirmed; 2 invalid input; 124 overall deadline; 130 interrupted. A timeout or interruption does not prove that nothing was sent.',
  ].join('\n\n'),
  options: {
    node: stringOption('Node ID', true),
    text: {
      type: 'string',
      valueName: 'text',
      description: 'Prompt text; use this or --text-file',
      fileVariant: true,
    },
    timeout: {
      type: 'number',
      valueName: 'duration',
      description: 'Total delivery timeout, e.g. 15s or 15000ms (default: 15s; maximum: 60s)',
    },
  },
  examples: [
    'opencove agent prompt --node node-123 --text "Review the changes"',
    'opencove agent prompt --node node-123 --text-file ./prompt.txt --timeout 20s',
    'cat prompt.txt | opencove agent prompt --node node-123 --text-file -',
  ],
  render: {
    ...declaredOutput(
      [
        'deliveryId',
        'nodeId',
        'sessionId',
        'phase',
        'turnId',
        'textComparison',
        'comparisonProfile',
        'promptId',
      ],
      {},
    ),
    examples: [
      'opencove agent prompt --node node-123 --text "Review the changes" --fields deliveryId',
      '{"deliveryId":"d"}',
    ],
  },
  buildInput: ({ options }) => {
    if (options.text === undefined) {
      usage(
        'Provide prompt text with --text or --text-file.',
        'Use exactly one. Use --text-file - to read from stdin.',
      )
    }
    const timeoutMs = options.timeout ?? 15000
    if (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 1 || Number(timeoutMs) > 60000) {
      usage(
        'The delivery timeout must be a whole number of milliseconds from 1ms to 60s.',
        'For example, use --timeout 15s or --timeout 15000ms.',
      )
    }
    try {
      canonicalizePromptText(String(options.text))
    } catch (error) {
      const descriptor = toAppErrorDescriptor(error),
        text = promptValidationPresentation(descriptor.details)
      throw new CliError(descriptor.code, 2, text.message, text.hint, descriptor.details)
    }
    return { nodeId: options.node, text: options.text, timeoutMs }
  },
})
