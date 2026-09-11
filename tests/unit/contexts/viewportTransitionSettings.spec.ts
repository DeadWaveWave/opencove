import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  isNormalizedAgentSettings,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'

describe('viewport transition settings', () => {
  it.each([undefined, null, {}, { viewportTransition: 'unknown' }, { viewportTransition: 3 }])(
    'preserves the existing flight for legacy or invalid settings: %j',
    value => {
      expect(normalizeAgentSettings(value).viewportTransition).toBe('fly')
    },
  )

  it.each(['fly', 'slide'] as const)('round trips the %s preference', viewportTransition => {
    const settings = normalizeAgentSettings({ viewportTransition })
    expect(settings.viewportTransition).toBe(viewportTransition)
    expect(normalizeAgentSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
    expect(isNormalizedAgentSettings(settings)).toBe(true)
  })

  it('rejects invalid values at the canonical settings boundary', () => {
    expect(
      isNormalizedAgentSettings({ ...DEFAULT_AGENT_SETTINGS, viewportTransition: 'invalid' }),
    ).toBe(false)
  })
})
