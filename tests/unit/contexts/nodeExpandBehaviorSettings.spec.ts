import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  isNormalizedAgentSettings,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import { createSettingsPanelUpdaters } from '../../../src/contexts/settings/presentation/renderer/useSettingsPanelUpdaters'

describe('window expansion settings', () => {
  it.each([undefined, null, {}, { nodeExpandBehavior: 'unknown' }, { nodeExpandBehavior: 3 }])(
    'defaults legacy or invalid settings to pushing nearby windows: %j',
    value => {
      expect(normalizeAgentSettings(value).nodeExpandBehavior).toBe('push-away')
    },
  )

  it.each(['push-away', 'find-space'] as const)(
    'round trips the %s preference',
    nodeExpandBehavior => {
      const settings = normalizeAgentSettings({ nodeExpandBehavior })
      expect(settings.nodeExpandBehavior).toBe(nodeExpandBehavior)
      expect(normalizeAgentSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
      expect(isNormalizedAgentSettings(settings)).toBe(true)
    },
  )

  it('rejects an invalid preference at the canonical settings boundary', () => {
    expect(
      isNormalizedAgentSettings({ ...DEFAULT_AGENT_SETTINGS, nodeExpandBehavior: 'invalid' }),
    ).toBe(false)
  })

  it('updates the layout preference through the settings owner while preserving other settings', () => {
    const onChange = vi.fn()
    const settings = { ...DEFAULT_AGENT_SETTINGS, uiTheme: 'pixel-light' as const }
    createSettingsPanelUpdaters({ settings, onChange }).updateNodeExpandBehavior('find-space')
    expect(onChange).toHaveBeenCalledWith({ ...settings, nodeExpandBehavior: 'find-space' })
  })
})
