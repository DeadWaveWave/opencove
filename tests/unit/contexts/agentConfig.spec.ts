import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  normalizeAgentSettings,
  resolveAgentModel,
  resolveTaskTitleModel,
  resolveTaskTitleProvider,
} from '../../../src/contexts/settings/domain/agentSettings'

describe('agent settings normalization', () => {
  it('returns defaults for invalid input', () => {
    expect(normalizeAgentSettings(null)).toEqual(DEFAULT_AGENT_SETTINGS)
    expect(normalizeAgentSettings('invalid')).toEqual(DEFAULT_AGENT_SETTINGS)
    expect(DEFAULT_AGENT_SETTINGS.language).toBe('en')
    expect(DEFAULT_AGENT_SETTINGS.normalizeZoomOnTerminalClick).toBe(true)
    expect(DEFAULT_AGENT_SETTINGS.canvasInputMode).toBe('auto')
    expect(DEFAULT_AGENT_SETTINGS.defaultTerminalWindowScalePercent).toBe(80)
    expect(DEFAULT_AGENT_SETTINGS.terminalFontSize).toBe(13)
    expect(DEFAULT_AGENT_SETTINGS.uiFontSize).toBe(18)
  })

  it('keeps valid provider, custom model, and model option fields', () => {
    const result = normalizeAgentSettings({
      language: 'zh-CN',
      defaultProvider: 'codex',
      customModelEnabledByProvider: {
        'claude-code': true,
        codex: false,
      },
      customModelByProvider: {
        'claude-code': 'claude-opus-4-6',
        codex: 'gpt-5.2-codex',
      },
      customModelOptionsByProvider: {
        'claude-code': ['claude-opus-4-6', 'claude-sonnet-4-5-20250929'],
        codex: ['gpt-5.2-codex', 'gpt-5.2-codex'],
      },
      taskTitleProvider: 'claude-code',
      taskTitleModel: 'claude-opus-4-6',
      taskTagOptions: ['feature', 'bug', 'feature', ''],
      normalizeZoomOnTerminalClick: false,
      canvasInputMode: 'trackpad',
      defaultTerminalWindowScalePercent: 95,
      terminalFontSize: 15,
      uiFontSize: 21,
    })

    expect(result.language).toBe('zh-CN')
    expect(result.defaultProvider).toBe('codex')
    expect(result.customModelEnabledByProvider['claude-code']).toBe(true)
    expect(result.customModelEnabledByProvider.codex).toBe(false)
    expect(result.customModelByProvider['claude-code']).toBe('claude-opus-4-6')
    expect(result.customModelByProvider.codex).toBe('gpt-5.2-codex')
    expect(result.customModelOptionsByProvider['claude-code']).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-5-20250929',
    ])
    expect(result.customModelOptionsByProvider.codex).toEqual(['gpt-5.2-codex'])
    expect(result.taskTitleProvider).toBe('claude-code')
    expect(result.taskTitleModel).toBe('claude-opus-4-6')
    expect(result.taskTagOptions).toEqual(['feature', 'bug'])
    expect(result.normalizeZoomOnTerminalClick).toBe(false)
    expect(result.canvasInputMode).toBe('trackpad')
    expect(result.defaultTerminalWindowScalePercent).toBe(95)
    expect(result.terminalFontSize).toBe(15)
    expect(result.uiFontSize).toBe(21)
    expect(resolveTaskTitleProvider(result)).toBe('claude-code')
    expect(resolveTaskTitleModel(result)).toBe('claude-opus-4-6')
    expect(resolveAgentModel(result, 'claude-code')).toBe('claude-opus-4-6')
    expect(resolveAgentModel(result, 'codex')).toBeNull()
  })

  it('trims custom model and keeps default behavior when empty', () => {
    const result = normalizeAgentSettings({
      defaultProvider: 'claude-code',
      customModelEnabledByProvider: {
        'claude-code': true,
        codex: true,
      },
      customModelByProvider: {
        'claude-code': '   ',
        codex: '  gpt-5.2-codex  ',
      },
      customModelOptionsByProvider: {
        'claude-code': ['  claude-opus-4-6  ', ''],
        codex: ['  gpt-5.2-codex  '],
      },
      taskTitleProvider: 'default',
      taskTitleModel: '   ',
      taskTagOptions: ['  ops ', 'ops', ''],
    })

    expect(result.customModelByProvider['claude-code']).toBe('')
    expect(result.customModelByProvider.codex).toBe('gpt-5.2-codex')
    expect(result.customModelOptionsByProvider['claude-code']).toEqual(['claude-opus-4-6'])
    expect(result.customModelOptionsByProvider.codex).toEqual(['gpt-5.2-codex'])
    expect(result.taskTitleProvider).toBe('default')
    expect(result.taskTitleModel).toBe('')
    expect(result.taskTagOptions).toEqual(['ops'])
    expect(result.normalizeZoomOnTerminalClick).toBe(true)
    expect(result.canvasInputMode).toBe('auto')
    expect(result.defaultTerminalWindowScalePercent).toBe(80)
    expect(result.terminalFontSize).toBe(13)
    expect(result.uiFontSize).toBe(18)
    expect(resolveAgentModel(result, 'claude-code')).toBeNull()
    expect(resolveAgentModel(result, 'codex')).toBe('gpt-5.2-codex')
    expect(resolveTaskTitleProvider(result)).toBe('claude-code')
    expect(resolveTaskTitleModel(result)).toBeNull()
  })

  it('falls back to auto canvas input mode when input is invalid', () => {
    const result = normalizeAgentSettings({
      language: 'fr-FR',
      canvasInputMode: 'touchscreen',
    })

    expect(result.language).toBe('en')
    expect(result.canvasInputMode).toBe('auto')
  })

  it('migrates legacy modelByProvider to custom override', () => {
    const result = normalizeAgentSettings({
      defaultProvider: 'codex',
      modelByProvider: {
        'claude-code': 'claude-sonnet-4-5-20250929',
        codex: 'gpt-5.2-codex',
      },
    })

    expect(result.customModelEnabledByProvider['claude-code']).toBe(true)
    expect(result.customModelEnabledByProvider.codex).toBe(true)
    expect(result.customModelByProvider['claude-code']).toBe('claude-sonnet-4-5-20250929')
    expect(result.customModelByProvider.codex).toBe('gpt-5.2-codex')
  })

  it('falls back to default task tags when options are invalid', () => {
    const result = normalizeAgentSettings({
      taskTagOptions: [123, null],
    })

    expect(result.taskTagOptions).toEqual(DEFAULT_AGENT_SETTINGS.taskTagOptions)
  })

  it('ensures selected custom model appears in options list', () => {
    const result = normalizeAgentSettings({
      defaultProvider: 'claude-code',
      customModelEnabledByProvider: {
        'claude-code': true,
        codex: false,
      },
      customModelByProvider: {
        'claude-code': 'claude-custom-lab',
        codex: '',
      },
      customModelOptionsByProvider: {
        'claude-code': ['claude-opus-4-6'],
        codex: [],
      },
    })

    expect(result.customModelOptionsByProvider['claude-code']).toEqual([
      'claude-custom-lab',
      'claude-opus-4-6',
    ])
  })

  it('clamps numeric appearance settings to safe ranges', () => {
    const result = normalizeAgentSettings({
      defaultTerminalWindowScalePercent: 999,
      terminalFontSize: 1,
      uiFontSize: 999,
    })

    expect(result.defaultTerminalWindowScalePercent).toBe(120)
    expect(result.terminalFontSize).toBe(10)
    expect(result.uiFontSize).toBe(24)
  })

  it('migrates legacy uiFontScalePercent to uiFontSize', () => {
    const result = normalizeAgentSettings({
      uiFontScalePercent: 125,
    })

    expect(result.uiFontSize).toBe(20)
  })
})
