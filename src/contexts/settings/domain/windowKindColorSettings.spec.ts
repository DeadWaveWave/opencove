import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from './agentSettings'

describe('window kind colour setting', () => {
  it('is on by default and when missing from saved settings', () => {
    expect(DEFAULT_AGENT_SETTINGS.windowKindColorsEnabled).toBe(true)
    expect(normalizeAgentSettings({ language: 'en' }).windowKindColorsEnabled).toBe(true)
  })

  it('keeps an explicit choice and ignores values that are not booleans', () => {
    expect(normalizeAgentSettings({ windowKindColorsEnabled: false }).windowKindColorsEnabled).toBe(
      false,
    )
    expect(normalizeAgentSettings({ windowKindColorsEnabled: 'no' }).windowKindColorsEnabled).toBe(
      true,
    )
  })
})
