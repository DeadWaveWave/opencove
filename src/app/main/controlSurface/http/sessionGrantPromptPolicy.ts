import type { AgentProviderId } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { GrantCheckDeps } from './sessionGrantPolicy'
import { assertInitialPromptText } from '../../../../shared/utils/initialPromptValidation'
import { initialPromptFeedback } from '../../../../shared/errors/initialPromptFeedback'

// Native TUI command channels, including Claude's legacy quick-memory entry.
const commandPrefixes: Readonly<Record<AgentProviderId, readonly string[]>> = {
  'claude-code': ['!', '/', '#', '&'],
  codex: ['!', '/'],
  opencode: ['!', '/'],
  pi: ['!', '/'],
  kimi: ['/'],
  gemini: ['!', '/'],
}
const commonPrefixes = commandPrefixes['claude-code'].filter(prefix =>
  Object.values(commandPrefixes).every(prefixes => prefixes.includes(prefix)),
)

/** Undefined provider permits only universally applicable checks before target resolution. */
export function assertSessionGrantMessagePrompt(
  text: string,
  options: { provider?: AgentProviderId; operationId: string; field: 'text' | 'prompt' },
): void {
  assertInitialPromptText(text)
  const prefixes = options.provider ? commandPrefixes[options.provider] : commonPrefixes
  // Python C0 separators, JS whitespace and Rust NEL are inspected without rewriting input.
  const inspected = text.replace(
    // eslint-disable-next-line no-control-regex -- Provider whitespace compatibility.
    /^[\s\p{White_Space}\u001c-\u001f]+|[\s\p{White_Space}\u001c-\u001f]+$/gu,
    '',
  )
  const promptReason = prefixes.includes(inspected.charAt(0))
    ? 'provider_command_prefix'
    : text.includes('@')
      ? 'unverified_file_reference'
      : options.provider === 'codex' && /\$[A-Za-z0-9_:-]+/.test(text)
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

export function checkSessionGrantPrompt(payload: unknown, deps: GrantCheckDeps): void {
  if (
    payload &&
    typeof payload === 'object' &&
    'text' in payload &&
    typeof payload.text === 'string'
  ) {
    assertSessionGrantMessagePrompt(payload.text, { operationId: deps.operationId, field: 'text' })
  }
}
