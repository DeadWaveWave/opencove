import type { AgentProviderId } from '../contracts/dto'
import { createAppError } from '../errors/appError'
import { assertInitialPromptText } from './initialPromptValidation'
import { initialPromptFeedback } from '../errors/initialPromptFeedback'
import {
  AGENT_PROVIDER_DESCRIPTORS,
  type AgentProviderInitialPromptPolicy,
} from '../contracts/agentProviderDescriptors'

// Native TUI command channels, including Claude's quick-memory entry.
const promptPolicies: readonly AgentProviderInitialPromptPolicy[] = Object.values(
  AGENT_PROVIDER_DESCRIPTORS,
).map(descriptor => descriptor.initialPrompt)
const commonPrefixes = promptPolicies[0].grantCommandPrefixes.filter(prefix =>
  promptPolicies.every(policy => policy.grantCommandPrefixes.includes(prefix)),
)
const SINGLE_ASCII_WORD = /^[\x21-\x7e]+$/u

/** Undefined provider permits only universally applicable checks before target resolution. */
export function assertSessionGrantMessagePrompt(
  text: string,
  options: { provider?: AgentProviderId; operationId: string; field: 'text' | 'prompt' },
): void {
  assertInitialPromptText(text)
  const policy = options.provider
    ? AGENT_PROVIDER_DESCRIPTORS[options.provider].initialPrompt
    : null
  const prefixes: readonly string[] = policy?.grantCommandPrefixes ?? commonPrefixes
  // Python C0 separators, JS whitespace and Rust NEL are inspected without rewriting input.
  const inspected = text.replace(
    // eslint-disable-next-line no-control-regex -- Provider whitespace handling.
    /^[\s\p{White_Space}\u001c-\u001f]+|[\s\p{White_Space}\u001c-\u001f]+$/gu,
    '',
  )
  const promptReason = prefixes.includes(inspected.charAt(0))
    ? 'provider_command_prefix'
    : text.includes('@')
      ? 'unverified_file_reference'
      : policy?.denyGrantSkillReferences && /\$[A-Za-z0-9_:-]+/.test(text)
        ? 'provider_skill_reference'
        : ['exit', 'quit', ':q', ':q!', ':wq', ':wq!'].includes(inspected.toLowerCase())
          ? 'provider_exit_word'
          : null
  if (!promptReason) {
    return
  }
  const feedback = initialPromptFeedback(promptReason, inspected)
  throw createAppError('common.forbidden', {
    params: feedback.params,
    details: {
      reason: 'field_denied',
      promptReason,
      operationId: options.operationId,
      field: options.field,
      message: feedback.message,
      hint: feedback.hint,
    },
  })
}

/** Launch-only grant checks, shared by the Worker and batch preflight. */
export function assertSessionGrantLaunchPrompt(prompt: string, operationId: string): void {
  assertSessionGrantMessagePrompt(prompt, { operationId, field: 'prompt' })
  // Provider commands, aliases and options are printable ASCII words. A prompt without spaces is
  // refused only when it could be one; CJK and other scripts are often written without spaces.
  if (SINGLE_ASCII_WORD.test(prompt)) {
    const feedback = initialPromptFeedback('command_token', prompt)
    throw createAppError('common.forbidden', {
      params: feedback.params,
      details: {
        reason: 'field_denied',
        operationId,
        field: 'prompt',
        message: feedback.message,
        hint: feedback.hint,
      },
    })
  }
}
