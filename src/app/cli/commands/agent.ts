import { turnReplyFields, validateTurnWaitOptions } from '../core/agentTurnComposition'
import { promptAndWait } from './agentPromptWait'
import { defineCommand } from '../core/command'
import { CliError, usage } from '../core/errors'
import { stringOption } from './nodes'
import { declaredOutput } from './declaredOutput'
import { canonicalizePromptText } from '../../../contexts/agent/domain/promptText'
import { toAppErrorDescriptor } from '../../../shared/errors/appError'
import { promptValidationPresentation } from '../../../shared/errors/agentPromptError'
import { INITIAL_PROMPT_RULES_TEXT } from '../../../shared/errors/initialPromptRules'

export const agentPromptCommand = defineCommand({
  path: ['agent', 'prompt'],
  connect: true,
  operation: 'agent.prompt',
  usage:
    '--node <target> [--wait [--read]] (<text> | --text <text> | --text-file <path|->) [options]',
  positionals: [{ name: 'text' }],
  summary: 'Send a prompt to an agent window OpenCove launched',
  description: [
    'Send text to Claude Code/Codex windows OpenCove launched. Inspect agent read --screen: drafts may be submitted. Working agents accept steering; --if-busy refuse rejects them. --expect-turn requires that turn. Claude clear settles after 200 ms of quiet; normal updates remain immediate. Waiting, unknown/degraded and unsupported sessions refuse. history_saturated: restart the agent window.',
    INITIAL_PROMPT_RULES_TEXT,
    '--wait confirms delivery and waits for its exact turn; --read returns the correlated reply. Check outcome and replyUnavailableReason. Stderr prints IDs and an interruption-only continuation command; final JSON reports results.',
    '--timeout: with --wait, confirmation/waiting default 20s, minimum 250ms, separate 15s send budget; otherwise sending defaults to 15s, maximum 60s.',
    'Never resend after uncertainty, interruption or textComparison: different. Resume agent delivery or agent wait --turn with returned IDs.',
    'Exit codes: 0 submitted/dispatched/turn-ended; 1 refused/unconfirmed; 2 invalid input; 4 authorization; 10 waiting; 11 exited; 124 timeout; 130 interrupted. Details: opencove skill coordinate.',
  ].join('\n\n'),
  execute: promptAndWait,
  options: {
    wait: { type: 'boolean', description: 'Confirm delivery and wait for its exact turn to end' },
    read: { type: 'boolean', description: 'Include the exact turn reply; requires --wait' },
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
      description:
        'Delivery budget, or confirmation + turn wait budget with --wait (e.g. 30s or 2m)',
    },
  },
  examples: [
    'opencove agent prompt --node node-123 --wait --read --timeout 2m --text "Review the changes"',
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
        ...turnReplyFields.filter(field => field !== 'turnId'),
      ],
      {},
    ),
    examples: [
      'opencove agent prompt --node node-123 --text "Review the changes" --fields deliveryId',
      '{"deliveryId":"d"}',
    ],
  },
  buildInput: ({ options, positionals }) => {
    validateTurnWaitOptions(options)
    if (positionals[0] !== undefined && options.text !== undefined) {
      usage('Choose one prompt text source: positional text, --text or --text-file.')
    }
    const text = options.text ?? positionals[0]
    if (text === undefined) {
      usage(
        'Provide prompt text as an argument, with --text or with --text-file.',
        'Use exactly one. Use --text-file - to read from stdin.',
      )
    }
    const timeoutMs = options.wait ? 15000 : (options.timeout ?? 15000)
    if (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 1 || Number(timeoutMs) > 60000) {
      usage(
        'The delivery timeout must be a whole number of milliseconds from 1ms to 60s.',
        'For example, use --timeout 15s or --timeout 15000ms.',
      )
    }
    try {
      canonicalizePromptText(String(text))
    } catch (error) {
      const descriptor = toAppErrorDescriptor(error),
        presentation = promptValidationPresentation(descriptor.details)
      throw new CliError(
        descriptor.code,
        2,
        presentation.message,
        presentation.hint,
        descriptor.details,
      )
    }
    return {
      nodeId: options.node,
      text,
      timeoutMs,
      ...(options['expect-turn'] !== undefined ? { expectTurnId: options['expect-turn'] } : {}),
    }
  },
})
