import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from './agentSettings'

describe('notification settings', () => {
  it('plays the pixel bit at 60% by default', () => {
    expect(DEFAULT_AGENT_SETTINGS).toMatchObject({
      notificationSoundEnabled: true,
      notificationSound: 'bit',
      notificationSoundVolume: 60,
    })
    expect(normalizeAgentSettings({})).toMatchObject({
      notificationSoundEnabled: true,
      notificationSound: 'bit',
      notificationSoundVolume: 60,
    })
  })

  it('keeps a saved sound, switch and volume', () => {
    expect(
      normalizeAgentSettings({
        notificationSoundEnabled: false,
        notificationSound: 'pebble',
        notificationSoundVolume: 25,
      }),
    ).toMatchObject({
      notificationSoundEnabled: false,
      notificationSound: 'pebble',
      notificationSoundVolume: 25,
    })
  })

  it('falls back on an unknown sound and clamps the volume to 0–100', () => {
    expect(normalizeAgentSettings({ notificationSound: 'chime' }).notificationSound).toBe('bit')
    expect(normalizeAgentSettings({ notificationSoundVolume: 140 }).notificationSoundVolume).toBe(
      100,
    )
    expect(normalizeAgentSettings({ notificationSoundVolume: -3 }).notificationSoundVolume).toBe(0)
    expect(normalizeAgentSettings({ notificationSoundVolume: 33.6 }).notificationSoundVolume).toBe(
      34,
    )
    expect(normalizeAgentSettings({ notificationSoundVolume: '80' }).notificationSoundVolume).toBe(
      60,
    )
    expect(
      normalizeAgentSettings({ notificationSoundEnabled: 'yes' }).notificationSoundEnabled,
    ).toBe(true)
  })

  it('keeps the in-app and system switches it already had', () => {
    expect(
      normalizeAgentSettings({ standbyBannerEnabled: false, systemNotificationsEnabled: false }),
    ).toMatchObject({ standbyBannerEnabled: false, systemNotificationsEnabled: false })
  })
})
