import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from './agentSettings'

describe('window material setting', () => {
  it('defaults to glass, which the system preference can still turn solid', () => {
    expect(DEFAULT_AGENT_SETTINGS.windowMaterial).toBe('glass')
    expect(normalizeAgentSettings({}).windowMaterial).toBe('glass')
    expect(normalizeAgentSettings({ windowMaterial: 'frosted' }).windowMaterial).toBe('glass')
  })

  it('keeps a saved choice', () => {
    expect(normalizeAgentSettings({ windowMaterial: 'solid' }).windowMaterial).toBe('solid')
  })
})
