import {
  NOTIFICATION_SOUNDS,
  type NotificationSettings,
  type NotificationSound,
} from './agentSettings.types'
import { DEFAULT_AGENT_SETTINGS } from './agentSettings.defaults'
import { normalizeBoolean, normalizeIntegerInRange } from './settingsNormalization'

export function normalizeNotificationSettings(
  value: Record<string, unknown>,
): NotificationSettings {
  const fallback = DEFAULT_AGENT_SETTINGS
  const flag = (key: keyof NotificationSettings): boolean =>
    normalizeBoolean(value[key]) ?? (fallback[key] as boolean)

  return {
    systemNotificationsEnabled: flag('systemNotificationsEnabled'),
    standbyBannerEnabled: flag('standbyBannerEnabled'),
    standbyBannerShowTask: flag('standbyBannerShowTask'),
    standbyBannerShowSpace: flag('standbyBannerShowSpace'),
    standbyBannerShowBranch: flag('standbyBannerShowBranch'),
    standbyBannerShowPullRequest: flag('standbyBannerShowPullRequest'),
    notificationSoundEnabled: flag('notificationSoundEnabled'),
    notificationSound: (NOTIFICATION_SOUNDS as readonly unknown[]).includes(value.notificationSound)
      ? (value.notificationSound as NotificationSound)
      : fallback.notificationSound,
    notificationSoundVolume: normalizeIntegerInRange(
      value.notificationSoundVolume,
      fallback.notificationSoundVolume,
      0,
      100,
    ),
  }
}
