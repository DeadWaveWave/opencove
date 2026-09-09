import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
  normalizeAgentSettings,
  normalizeSelectableAgentProviderOrder,
} from '../../../src/contexts/settings/domain/agentSettings'
import { createSettingsPanelUpdaters } from '../../../src/contexts/settings/presentation/renderer/useSettingsPanelUpdaters'

describe('agent provider preference', () => {
  it('keeps the persisted default first without losing compatibility-only providers', () => {
    const settings = normalizeAgentSettings({
      defaultProvider: 'pi',
      agentProviderOrder: ['codex', 'gemini', 'opencode', 'claude-code', 'pi', 'kimi'],
    })

    expect(settings.defaultProvider).toBe('pi')
    expect(settings.agentProviderOrder).toEqual([
      'pi',
      'gemini',
      'codex',
      'opencode',
      'claude-code',
      'kimi',
    ])
    expect(normalizeAgentSettings(settings)).toEqual(settings)
    expect(normalizeSelectableAgentProviderOrder(settings.agentProviderOrder)[0]).toBe('pi')
  })

  it('preserves a legacy hidden default while projecting its selectable fallback first', () => {
    const settings = normalizeAgentSettings({
      defaultProvider: 'gemini',
      agentProviderOrder: ['gemini', 'pi', 'codex', 'claude-code', 'opencode', 'kimi'],
    })
    expect(settings.defaultProvider).toBe('gemini')
    expect(settings.agentProviderOrder[0]).toBe('gemini')
    expect(normalizeSelectableAgentProviderOrder(settings.agentProviderOrder)[0]).toBe(
      'claude-code',
    )
  })

  it('writes order and default together once when reordering', () => {
    const onChange = vi.fn()
    const settings = normalizeAgentSettings({
      ...DEFAULT_AGENT_SETTINGS,
      agentProviderOrder: ['codex', 'gemini', 'claude-code', 'opencode', 'pi', 'kimi'],
    })
    createSettingsPanelUpdaters({ settings, onChange }).updateAgentProviderOrder([
      'kimi',
      'pi',
      'codex',
      'claude-code',
      'opencode',
    ])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      defaultProvider: 'kimi',
      agentProviderOrder: ['kimi', 'gemini', 'pi', 'codex', 'claude-code', 'opencode'],
    })
    expect(settings.defaultProvider).toBe('codex')
  })

  it('moves a detail-page default choice to the first selectable position atomically', () => {
    const onChange = vi.fn()
    createSettingsPanelUpdaters({
      settings: DEFAULT_AGENT_SETTINGS,
      onChange,
    }).updateDefaultProvider('opencode')
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(next.defaultProvider).toBe('opencode')
    expect(normalizeSelectableAgentProviderOrder(next.agentProviderOrder)[0]).toBe('opencode')
    expect(new Set(next.agentProviderOrder)).toEqual(new Set(AGENT_PROVIDERS))
  })
})
