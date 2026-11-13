import { assertSessionGrantMessagePrompt } from './sessionGrantPromptPolicy'
import { createAppError } from '../../../../shared/errors/appError'
import type { GrantCheckDeps } from './sessionGrantPolicy'
import { initialPromptFeedback } from '../../../../shared/errors/initialPromptFeedback'

const commonFields = ['prompt', 'provider', 'model', 'agentFullAccess', 'cols', 'rows']
const localFields = new Set([...commonFields, 'spaceId', 'cwd'])
const mountedFields = new Set([...commonFields, 'mountId', 'cwdUri'])
export const SESSION_GRANT_FULL_ACCESS_PATH =
  'Settings → Agent → Providers → Permissions → Full Access Mode'
export const SESSION_GRANT_LAUNCH_REJECTED_FIELDS: Readonly<Record<string, string>> = {
  env: 'the user’s configured agent environment always applies',
  executablePathOverride: 'the user’s configured agent executable always applies',
  resumeSessionId: 'agent terminals can only start new conversations',
  codexReuseRunningAppServer: 'agent terminals cannot change the agent connection policy',
  mode: 'agent terminals can only start new conversations; omit mode',
}

const SINGLE_ASCII_WORD = /^[\x21-\x7e]+$/u

export function checkSessionGrantLaunch(payload: unknown, deps: GrantCheckDeps): void {
  const allowedFields = deps.operationId === 'session.launchAgent' ? localFields : mountedFields
  // Validation normalizes omitted overrides to null and mode to new. Inspect the wire keys
  // after validation, so explicit false/null/new cannot masquerade as an omitted field.
  if (!deps.wirePayload || typeof deps.wirePayload !== 'object') {
    throw createAppError('common.forbidden', {
      details: {
        reason: 'field_denied',
        operationId: deps.operationId,
        message: 'Agent launch input is unavailable.',
      },
    })
  }
  for (const field of Object.keys(deps.wirePayload)) {
    if (allowedFields.has(field)) {
      continue
    }
    const reasons = SESSION_GRANT_LAUNCH_REJECTED_FIELDS
    const message = `${deps.operationId}.${field} is not available to agent terminals: ${Object.hasOwn(reasons, field) ? reasons[field] : 'this launch field is not approved for agent terminals'}.`
    throw createAppError('common.forbidden', {
      details: { reason: 'field_denied', operationId: deps.operationId, field, message },
    })
  }
  const prompt =
    payload &&
    typeof payload === 'object' &&
    'prompt' in payload &&
    typeof payload.prompt === 'string'
      ? payload.prompt.trim()
      : ''
  assertSessionGrantMessagePrompt(prompt, { operationId: deps.operationId, field: 'prompt' })
  // Provider commands, aliases and options are printable ASCII words. A prompt without spaces is
  // refused only when it could be one; CJK and other scripts are often written without spaces.
  if (SINGLE_ASCII_WORD.test(prompt)) {
    const feedback = initialPromptFeedback('command_token', prompt)
    throw createAppError('common.forbidden', {
      params: feedback.params,
      details: {
        reason: 'field_denied',
        operationId: deps.operationId,
        field: 'prompt',
        message: feedback.message,
        hint: feedback.hint,
      },
    })
  }
}
