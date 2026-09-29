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
    expect(isPluginEnabled(settings, 'git-board')).toBe(true)
    expect(settings.pluginContributions).toEqual({})
    expect(isPluginContributionEnabled(settings, 'git-board', 'actionBar')).toBe(true)
    expect(isPluginContributionEnabled(settings, 'git-board', 'contextMenu')).toBe(true)
  })

  it('normalizes saved IDs without losing preferences for unavailable plugins', () => {
    const disabledPluginIds = [' git-board ', 'custom-plugin', null, 'git-board', '']
    expect(normalizeAgentSettings({ disabledPluginIds }).disabledPluginIds).toEqual([
      'git-board',
      'custom-plugin',
    ])
    expect(normalizeDisabledPluginIds('git-board')).toEqual([])
  })

  it('changes one plugin preference without mutating another plugin or its input', () => {
    const settings = { disabledPluginIds: ['custom-plugin'] }
    const disabledPluginIds = setPluginEnabled(settings, 'git-board', false)
    expect(disabledPluginIds).toEqual(['custom-plugin', 'git-board'])
    expect(isPluginEnabled({ disabledPluginIds }, 'git-board')).toBe(false)
    expect(setPluginEnabled({ disabledPluginIds }, 'git-board', false)).toEqual(disabledPluginIds)
    expect(setPluginEnabled({ disabledPluginIds }, 'git-board', true)).toEqual(['custom-plugin'])
    expect(settings.disabledPluginIds).toEqual(['custom-plugin'])
  })

  it('updates entry visibility independently without disabling a plugin or mutating preferences', () => {
    const settings = {
      disabledPluginIds: [],
      pluginContributions: { 'another-plugin': { contextMenu: false } },
    }
    const pluginContributions = setPluginContributionEnabled(
      settings,
      'git-board',
      'actionBar',
      false,
    )
    const next = { ...settings, pluginContributions }
    expect(isPluginEnabled(next, 'git-board')).toBe(true)
    expect(isPluginContributionEnabled(next, 'git-board', 'actionBar')).toBe(false)
    expect(isPluginContributionEnabled(next, 'git-board', 'contextMenu')).toBe(true)
    expect(next.pluginContributions['another-plugin']).toEqual({ contextMenu: false })
    expect(settings.pluginContributions).toEqual({ 'another-plugin': { contextMenu: false } })
  })

  it('retains entry preferences across plugin disable, enable and saved-profile normalization', () => {
    const initial = {
      disabledPluginIds: ['git-board'],
      pluginContributions: { 'git-board': { actionBar: false, contextMenu: true } },
    }
    const restored = normalizeAgentSettings(JSON.parse(JSON.stringify(initial)))
    const enabled = {
      ...restored,
      disabledPluginIds: setPluginEnabled(restored, 'git-board', true),
    }
    expect(isPluginEnabled(enabled, 'git-board')).toBe(true)
    expect(isPluginContributionEnabled(enabled, 'git-board', 'actionBar')).toBe(false)
    expect(isPluginContributionEnabled(enabled, 'git-board', 'contextMenu')).toBe(true)
  })

  it('normalizes entry preferences and keeps known flags for temporarily unavailable plugins', () => {
    expect(normalizePluginContributions(null)).toEqual({})
    expect(normalizePluginContributions([])).toEqual({})
    const result = normalizePluginContributions({
      ' git-board ': { actionBar: false, contextMenu: 'false', unexpected: true },
      'missing-plugin': { actionBar: true, contextMenu: false },
      invalid: [],
      '': { actionBar: false },
    })
    expect(result).toEqual({
      'git-board': { actionBar: false },
      'missing-plugin': { actionBar: true, contextMenu: false },
    })
    expect(
      isPluginContributionEnabled({ pluginContributions: result }, 'git-board', 'contextMenu'),
    ).toBe(true)
  })
})
