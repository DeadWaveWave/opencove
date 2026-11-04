import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from './agentSettings'

describe('reduce transparency setting', () => {
  it('defaults to following the system', () => {
    expect(DEFAULT_AGENT_SETTINGS.reduceTransparency).toBe(false)
    expect(normalizeAgentSettings({}).reduceTransparency).toBe(false)
    expect(normalizeAgentSettings({ reduceTransparency: 'yes' }).reduceTransparency).toBe(false)
  })

  it('keeps a saved choice', () => {
    expect(normalizeAgentSettings({ reduceTransparency: true }).reduceTransparency).toBe(true)
  })
})
