import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_UI_LANGUAGE } from '@contexts/settings/domain/agentSettings'
import { applyUiLanguage } from '@app/renderer/i18n'
import { toAgentNodeTitle, toErrorMessage, toRelativeTime } from './format'

describe('format', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))
  })

  afterEach(async () => {
    await applyUiLanguage(DEFAULT_UI_LANGUAGE)
    vi.useRealTimers()
  })

  it('localizes relative time using the active UI language', async () => {
    await applyUiLanguage('en')
    expect(toRelativeTime('2026-03-15T11:59:00.000Z')).toBe('1 minute ago')

    await applyUiLanguage('zh-CN')
    expect(toRelativeTime('2026-03-15T11:59:00.000Z')).toBe('1分钟前')
  })

  it('localizes fallback labels in non-hook helpers', async () => {
    await applyUiLanguage('zh-CN')
    expect(toErrorMessage(null)).toBe('未知错误')
    expect(toAgentNodeTitle('opencode', null)).toBe('opencode · 默认模型')
  })
})
