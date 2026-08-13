import { describe, expect, it } from 'vitest'
import { resolveProviderFromSettings } from '../../../src/app/main/controlSurface/handlers/sessionLaunchSupport'
import { normalizeAgentSettings } from '../../../src/contexts/settings/domain/agentSettings'

describe('resolveProviderFromSettings', () => {
  it('falls back to a selectable provider for new sessions without mutating durable settings', () => {
    const settings = normalizeAgentSettings({ defaultProvider: 'gemini' })

    expect(resolveProviderFromSettings(null, settings, 'new')).toBe('claude-code')
    expect(resolveProviderFromSettings('gemini', settings, 'new')).toBe('claude-code')
    expect(settings.defaultProvider).toBe('gemini')
  })

  it('uses a selectable persisted default when a new-session request is not selectable', () => {
    const settings = normalizeAgentSettings({ defaultProvider: 'codex' })

    expect(resolveProviderFromSettings('gemini', settings, 'new')).toBe('codex')
    expect(resolveProviderFromSettings('invalid', settings, 'new')).toBe('codex')
  })

  it('keeps compatibility-only providers valid for session resume', () => {
    const settings = normalizeAgentSettings({ defaultProvider: 'codex' })

    expect(resolveProviderFromSettings('gemini', settings, 'resume')).toBe('gemini')
  })
})
