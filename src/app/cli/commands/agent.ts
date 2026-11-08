import { sendAgentPrompt } from '../core/agentPromptRequest'
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
    'Send text to a local Claude Code or Codex agent window OpenCove launched. Inspect drafts/dialogs with agent read --screen first; existing drafts may be submitted too. Use exactly one of --text or --text-file (- reads stdin).',
    'Working agents receive steering by default; --if-busy refuse rejects busy agents. --expect-turn requires that exact active turn. Waiting, unknown/degraded and unsupported sessions refuse; idle requires a hook-observed settled turn.',
    'Loop: prompt → delivery <deliveryId> --wait → wait --turn <turnId> → read --turn <turnId> -o json. Save deliveryId (also printed before sending) and turnId. Codex dispatched needs delivery confirmation. Turn end does not prove your request was handled; inspect outcome and reply.',
    'Never resend after uncertainty, interruption, transport loss or textComparison: different. Inspect delivery status and --screen; different still exits 0. This command never retries.',
    'Exit codes: 0 submission observed or Codex steer dispatched; 1 refusal/unconfirmed; 2 invalid input; 124 deadline; 130 interruption. Timeout/interruption may follow submission. Trust limits, supported invocations and recovery: opencove skill.',
  ].join('\n\n'),
  execute: sendAgentPrompt,
  options: {
    'expect-turn': {
      type: 'string',
      valueName: 'turnId',
      description:
        'Steer only into this exact active turn; idle or another turn refuses before paste',
    },
    'if-busy': {
      type: 'string',
      choices: ['steer', 'refuse'],
      description: 'Steer the current working turn (default), or refuse',
    },
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
    'opencove agent prompt --node node-123 --expect-turn turn-123 --text "Include refunds"',
    'cat prompt.txt | opencove agent prompt --node node-123 --text-file -',
  ],
  render: {
    ...declaredOutput(
      [
        'deliveryId',
        'nodeId',
        'sessionId',
        'phase',
        'mode',
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
    return {
      nodeId: options.node,
      text: options.text,
      timeoutMs,
      ...(options['expect-turn'] !== undefined ? { expectTurnId: options['expect-turn'] } : {}),
    }
  },
})
