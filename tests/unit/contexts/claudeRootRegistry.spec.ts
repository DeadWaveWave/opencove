// @vitest-environment node
import { expect, it } from 'vitest'
import { registrationNames } from '../../../scripts/lib/claudeRootRegistry.mjs'
import audit from '../../fixtures/provider-argv/claudeRegistrySource.json'
import { CLAUDE_ROOT_COMMANDS } from '../../../src/shared/utils/claudeRootCommands.generated'
import { assertProviderInitialPrompt as sharedPromptPolicy } from '../../../src/shared/utils/providerInitialPromptPolicy'
import { assertProviderInitialPrompt } from '../../../src/contexts/agent/domain/providerInitialPromptPolicy'
it('matches the pinned installed root registrations, including every chained alias', () => {
  const expected = [
    ...new Set(audit.registrations.flatMap(row => registrationNames(row.expression))),
  ].sort()
  expect(assertProviderInitialPrompt).toBe(sharedPromptPolicy)
  expect(CLAUDE_ROOT_COMMANDS).toEqual(expected)
  expect(expected).toContain('plugins')
  expect(() => assertProviderInitialPrompt('claude-code', 'plugins')).toThrow()
})
