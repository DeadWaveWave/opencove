import { describe, expect, it } from 'vitest'
import { normalizeAgentSettings } from './agentSettings'
import {
  isPluginEnabled,
  normalizeDisabledPluginIds,
  setPluginEnabled,
  isPluginContributionEnabled,
  normalizePluginContributions,
  setPluginContributionEnabled,
} from './pluginSettings'

describe('plugin enablement settings', () => {
  it('enables plugins when restoring profiles created before plugin settings existed', () => {
    const settings = normalizeAgentSettings({})
    expect(settings.disabledPluginIds).toEqual([])
    expect(isPluginEnabled(settings, 'sample-plugin')).toBe(true)
    expect(settings.pluginContributions).toEqual({})
    expect(isPluginContributionEnabled(settings, 'sample-plugin', 'actionBar')).toBe(true)
    expect(isPluginContributionEnabled(settings, 'sample-plugin', 'contextMenu')).toBe(true)
  })

  it('normalizes saved IDs without losing preferences for unavailable plugins', () => {
    const disabledPluginIds = [' sample-plugin ', 'custom-plugin', null, 'sample-plugin', '']
    expect(normalizeAgentSettings({ disabledPluginIds }).disabledPluginIds).toEqual([
      'sample-plugin',
      'custom-plugin',
    ])
    expect(normalizeDisabledPluginIds('sample-plugin')).toEqual([])
  })

  it('changes one plugin preference without mutating another plugin or its input', () => {
    const settings = { disabledPluginIds: ['custom-plugin'] }
    const disabledPluginIds = setPluginEnabled(settings, 'sample-plugin', false)
    expect(disabledPluginIds).toEqual(['custom-plugin', 'sample-plugin'])
    expect(isPluginEnabled({ disabledPluginIds }, 'sample-plugin')).toBe(false)
    expect(setPluginEnabled({ disabledPluginIds }, 'sample-plugin', false)).toEqual(
      disabledPluginIds,
    )
    expect(setPluginEnabled({ disabledPluginIds }, 'sample-plugin', true)).toEqual([
      'custom-plugin',
    ])
    expect(settings.disabledPluginIds).toEqual(['custom-plugin'])
  })

  it('updates entry visibility independently without disabling a plugin or mutating preferences', () => {
    const settings = {
      disabledPluginIds: [],
      pluginContributions: { 'another-plugin': { contextMenu: false } },
    }
    const pluginContributions = setPluginContributionEnabled(
      settings,
      'sample-plugin',
      'actionBar',
      false,
    )
    const next = { ...settings, pluginContributions }
    expect(isPluginEnabled(next, 'sample-plugin')).toBe(true)
    expect(isPluginContributionEnabled(next, 'sample-plugin', 'actionBar')).toBe(false)
    expect(isPluginContributionEnabled(next, 'sample-plugin', 'contextMenu')).toBe(true)
    expect(next.pluginContributions['another-plugin']).toEqual({ contextMenu: false })
    expect(settings.pluginContributions).toEqual({ 'another-plugin': { contextMenu: false } })
  })

  it('retains entry preferences across plugin disable, enable and saved-profile normalization', () => {
    const initial = {
      disabledPluginIds: ['sample-plugin'],
      pluginContributions: { 'sample-plugin': { actionBar: false, contextMenu: true } },
    }
    const restored = normalizeAgentSettings(JSON.parse(JSON.stringify(initial)))
    const enabled = {
      ...restored,
      disabledPluginIds: setPluginEnabled(restored, 'sample-plugin', true),
    }
    expect(isPluginEnabled(enabled, 'sample-plugin')).toBe(true)
    expect(isPluginContributionEnabled(enabled, 'sample-plugin', 'actionBar')).toBe(false)
    expect(isPluginContributionEnabled(enabled, 'sample-plugin', 'contextMenu')).toBe(true)
  })

  it('normalizes entry preferences and keeps known flags for temporarily unavailable plugins', () => {
    expect(normalizePluginContributions(null)).toEqual({})
    expect(normalizePluginContributions([])).toEqual({})
    const result = normalizePluginContributions({
      ' sample-plugin ': { actionBar: false, contextMenu: 'false', unexpected: true },
      'missing-plugin': { actionBar: true, contextMenu: false },
      invalid: [],
      '': { actionBar: false },
    })
    expect(result).toEqual({
      'sample-plugin': { actionBar: false },
      'missing-plugin': { actionBar: true, contextMenu: false },
    })
    expect(
      isPluginContributionEnabled({ pluginContributions: result }, 'sample-plugin', 'contextMenu'),
    ).toBe(true)
  })
})
