import type { AgentProviderId } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { GrantCheckDeps } from './sessionGrantPolicy'

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
  const prefixes = options.provider ? commandPrefixes[options.provider] : commonPrefixes
  // Include Python's C0 separators and Unicode whitespace (such as Rust's NEL).
  // eslint-disable-next-line no-control-regex -- Inspect provider whitespace without rewriting input.
  const first = text.replace(/^[\s\p{White_Space}\u001c-\u001f]+/u, '').charAt(0)
  if (!prefixes.includes(first)) {
    return
  }
  const list =
    prefixes.length > 1 ? `${prefixes.slice(0, -1).join(', ')} or ${prefixes.at(-1)}` : prefixes[0]
  throw createAppError('common.forbidden', {
    details: {
      reason: 'field_denied',
      promptReason: 'provider_command_prefix',
      operationId: options.operationId,
      field: options.field,
      message: `Prompts from agent terminals cannot start with ${list}; ${prefixes.length === 1 ? 'this prefix can run commands' : 'these prefixes can run commands'} in the target agent, so start with words.`,
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
