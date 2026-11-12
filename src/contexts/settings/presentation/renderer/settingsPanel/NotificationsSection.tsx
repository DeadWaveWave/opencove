import React from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { PlayIcon } from '@app/renderer/components/ui/pixelIcons'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import { playNotificationSound } from '@app/renderer/shell/utils/notificationSound'
import {
  NOTIFICATION_SOUNDS,
  type NotificationSettings,
  type NotificationSound,
} from '@contexts/settings/domain/agentSettings'
import { RangeField } from './RangeField'
import { SettingsGroup, SettingsGroupBody, SettingsModule } from './SettingsGroup'

type NotificationSettingChange = <Key extends keyof NotificationSettings>(
  key: Key,
  value: NotificationSettings[Key],
) => void

/**
 * How an Agent that needs you is announced: three channels (the in-app card, the system
 * notification, the one sound), then what the card shows.
 */
export function NotificationsSection({
  settings,
  onChange,
}: {
  settings: NotificationSettings & { githubPullRequestsEnabled: boolean }
  onChange: NotificationSettingChange
}): React.JSX.Element {
  const { t } = useTranslation()
  const isCardOff = !settings.standbyBannerEnabled
  const isSoundOff = !settings.notificationSoundEnabled

  const switchRow = (
    key: 'standbyBannerEnabled' | 'systemNotificationsEnabled' | 'notificationSoundEnabled',
    copy: 'agentStandbyBanner' | 'systemNotifications' | 'sound',
    testId: string,
  ) => (
    <SettingRow
      label={t(`settingsPanel.notifications.${copy}.enabledLabel`)}
      description={t(`settingsPanel.notifications.${copy}.enabledHelp`)}
      control={
        <Toggle
          data-testid={testId}
          checked={settings[key]}
          label={t(`settingsPanel.notifications.${copy}.enabledLabel`)}
          onCheckedChange={checked => onChange(key, checked)}
        />
      }
    />
  )

  const contextRow = (
    key:
      | 'standbyBannerShowTask'
      | 'standbyBannerShowSpace'
      | 'standbyBannerShowBranch'
      | 'standbyBannerShowPullRequest',
    copy: 'showTask' | 'showSpace' | 'showBranch' | 'showPullRequest',
    testId: string,
    disabled = isCardOff,
  ) => (
    <SettingRow
      data-testid={testId}
      label={t(`settingsPanel.notifications.agentStandbyBanner.${copy}`)}
      control={
        <Toggle
          checked={settings[key]}
          disabled={disabled}
          label={t(`settingsPanel.notifications.agentStandbyBanner.${copy}`)}
          onCheckedChange={checked => onChange(key, checked)}
        />
      }
    />
  )

  return (
    <>
      <SettingsGroup
        id="settings-section-notifications"
        title={t('settingsPanel.groups.notifications.system')}
      >
        <SettingsGroupBody>
          {switchRow(
            'standbyBannerEnabled',
            'agentStandbyBanner',
            'settings-agent-standby-banner-enabled',
          )}
          {switchRow(
            'systemNotificationsEnabled',
            'systemNotifications',
            'settings-system-notifications-enabled',
          )}
          {switchRow('notificationSoundEnabled', 'sound', 'settings-notification-sound-enabled')}

          <SettingRow
            label={t('settingsPanel.notifications.sound.choiceLabel')}
            control={
              <div className="settings-panel__inline-controls">
                <CoveSelect
                  testId="settings-notification-sound"
                  ariaLabel={t('settingsPanel.notifications.sound.choiceLabel')}
                  value={settings.notificationSound}
                  disabled={isSoundOff}
                  options={NOTIFICATION_SOUNDS.map(sound => ({
                    value: sound,
                    label: t(`settingsPanel.notifications.sound.choices.${sound}`),
                  }))}
                  onChange={value => onChange('notificationSound', value as NotificationSound)}
                />
                <Button
                  size="sm"
                  data-testid="settings-notification-sound-preview"
                  disabled={isSoundOff}
                  onClick={() =>
                    playNotificationSound(
                      settings.notificationSound,
                      settings.notificationSoundVolume,
                    )
                  }
                >
                  <PlayIcon size={12} />
                  {t('settingsPanel.notifications.sound.preview')}
                </Button>
              </div>
            }
          />

          <SettingRow
            label={t('settingsPanel.notifications.sound.volumeLabel')}
            control={
              <RangeField
                data-testid="settings-notification-sound-volume"
                aria-label={t('settingsPanel.notifications.sound.volumeLabel')}
                value={settings.notificationSoundVolume}
                valueLabel={`${settings.notificationSoundVolume}%`}
                disabled={isSoundOff}
                min={0}
                max={100}
                step={5}
                onChange={event => onChange('notificationSoundVolume', Number(event.target.value))}
              />
            }
          />
        </SettingsGroupBody>
      </SettingsGroup>

      <SettingsGroup
        id="settings-section-standby-banner"
        title={t('settingsPanel.groups.notifications.standby')}
      >
        <SettingsGroupBody>
          <SettingsModule
            id="settings-standby-banner-context"
            title={t('settingsPanel.notifications.agentStandbyBanner.contextTitle')}
            description={t('settingsPanel.notifications.agentStandbyBanner.contextHelp')}
          >
            {contextRow('standbyBannerShowTask', 'showTask', 'settings-standby-banner-show-task')}
            {contextRow(
              'standbyBannerShowSpace',
              'showSpace',
              'settings-standby-banner-show-space',
            )}
            {contextRow(
              'standbyBannerShowBranch',
              'showBranch',
              'settings-standby-banner-show-branch',
            )}
            {contextRow(
              'standbyBannerShowPullRequest',
              'showPullRequest',
              'settings-standby-banner-show-pr',
              isCardOff || !settings.githubPullRequestsEnabled,
            )}
          </SettingsModule>
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
