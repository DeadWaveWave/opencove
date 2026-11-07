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
  summary: 'Paste a prompt and press Enter in a local Claude Code session',
  description: [
    'The agent must have finished a turn that OpenCove observed. This command refuses while the agent is working, waiting for input, or not known to be ready. Use exactly one text source; --text-file - reads stdin. Text must be valid Unicode, nonblank and at most 32 KiB in UTF-8 before newline normalization; trailing newlines are removed.',
    'This attempts to paste into the current editor; any existing draft may be submitted with it. Check for drafts and dialogs first: unseen dialogs, including one-time settings notices, may consume the input.',
    'Success (submission_observed) means Claude Code reported a newly submitted prompt after this Enter. It does not prove the model read exactly this text, and the turn may still be running: wait for it with the agent event stream. The exact checks and their trust limits are in docs/agent/PROMPT_DELIVERY.md.',
    'This command never retries automatically. After an interrupted or uncertain delivery, inspect the agent terminal and conversation. Do not resend a prompt that may already have been submitted.',
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
    ...declaredOutput(['deliveryId', 'nodeId', 'sessionId', 'phase', 'turnId'], {}),
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
