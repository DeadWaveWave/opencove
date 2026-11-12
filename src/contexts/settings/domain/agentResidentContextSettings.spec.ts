import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from './agentSettings'

it('defaults absent and invalid resident context settings to suggest', () => {
  expect(DEFAULT_AGENT_SETTINGS.agentResidentContext).toBe('suggest')
  for (const value of [
    undefined,
    null,
    {},
    { agentResidentContext: 'bad' },
    { agentResidentContext: false },
  ]) {
    expect(normalizeAgentSettings(value).agentResidentContext).toBe('suggest')
  }
})
it.each(['suggest', 'off'] as const)('preserves resident context mode %s', mode => {
  expect(normalizeAgentSettings({ agentResidentContext: mode }).agentResidentContext).toBe(mode)
})
