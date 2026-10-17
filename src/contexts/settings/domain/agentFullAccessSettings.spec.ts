import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from './agentSettings'

describe('agent full access setting', () => {
  it('starts off for a new install', () => {
    expect(DEFAULT_AGENT_SETTINGS.agentFullAccess).toBe(false)
    expect(normalizeAgentSettings(undefined).agentFullAccess).toBe(false)
    expect(normalizeAgentSettings(null).agentFullAccess).toBe(false)
    // Persistence stores "nothing saved yet" as an empty record.
    expect(normalizeAgentSettings({}).agentFullAccess).toBe(false)
  })

  it('keeps full access for saved settings from before the setting was written', () => {
    expect(normalizeAgentSettings({ language: 'en' }).agentFullAccess).toBe(true)
  })

  it('keeps an explicit choice either way', () => {
    expect(normalizeAgentSettings({ agentFullAccess: false }).agentFullAccess).toBe(false)
    expect(normalizeAgentSettings({ agentFullAccess: true }).agentFullAccess).toBe(true)
  })
})
