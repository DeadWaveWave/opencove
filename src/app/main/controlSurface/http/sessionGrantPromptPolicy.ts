import type { GrantCheckDeps } from './sessionGrantPolicy'
import { assertSessionGrantMessagePrompt } from '../../../../shared/utils/grantInitialPromptPolicy'
export { assertSessionGrantMessagePrompt } from '../../../../shared/utils/grantInitialPromptPolicy'

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
