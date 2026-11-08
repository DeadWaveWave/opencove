import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from './agentSettings'

describe('Codex app-server reuse settings', () => {
  it('defaults new and legacy settings to isolated launches', () => {
    expect(DEFAULT_AGENT_SETTINGS.codexReuseRunningAppServer).toBe(false)
    for (const value of [undefined, null, {}, { language: 'en' }]) {
      expect(normalizeAgentSettings(value).codexReuseRunningAppServer).toBe(false)
    }
  })

  it.each([false, true])('preserves explicit reuse=%s', enabled => {
    expect(
      normalizeAgentSettings({ codexReuseRunningAppServer: enabled }).codexReuseRunningAppServer,
    ).toBe(enabled)
  })

  it.each(['true', 1, null, {}, []])('rejects non-boolean reuse=%j', value => {
    expect(
      normalizeAgentSettings({ codexReuseRunningAppServer: value }).codexReuseRunningAppServer,
    ).toBe(false)
  })
})
