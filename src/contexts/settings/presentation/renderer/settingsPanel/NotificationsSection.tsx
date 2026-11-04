import React from 'react'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsGroup, SettingsGroupBody, SettingsModule } from './SettingsGroup'

export function NotificationsSection(props: {
  systemNotificationsEnabled: boolean
  standbyBannerEnabled: boolean
  standbyBannerShowTask: boolean
  standbyBannerShowSpace: boolean
  standbyBannerShowBranch: boolean
  standbyBannerShowPullRequest: boolean
  githubPullRequestsEnabled: boolean
  onChangeSystemNotificationsEnabled: (enabled: boolean) => void
  onChangeStandbyBannerEnabled: (enabled: boolean) => void
  onChangeStandbyBannerShowTask: (enabled: boolean) => void
  onChangeStandbyBannerShowSpace: (enabled: boolean) => void
  onChangeStandbyBannerShowBranch: (enabled: boolean) => void
  onChangeStandbyBannerShowPullRequest: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    systemNotificationsEnabled,
    standbyBannerEnabled,
    standbyBannerShowTask,
    standbyBannerShowSpace,
    standbyBannerShowBranch,
    standbyBannerShowPullRequest,
    githubPullRequestsEnabled,
    onChangeSystemNotificationsEnabled,
    onChangeStandbyBannerEnabled,
    onChangeStandbyBannerShowTask,
    onChangeStandbyBannerShowSpace,
    onChangeStandbyBannerShowBranch,
    onChangeStandbyBannerShowPullRequest,
  } = props

  return (
    <>
      <SettingsGroup
        id="settings-section-notifications"
        title={t('settingsPanel.groups.notifications.system')}
      >
        <SettingsGroupBody>
          <SettingRow
            label={t('settingsPanel.notifications.systemNotifications.enabledLabel')}
            description={t('settingsPanel.notifications.systemNotifications.enabledHelp')}
            control={
              <Toggle
                data-testid="settings-system-notifications-enabled"
                checked={systemNotificationsEnabled}
                label={t('settingsPanel.notifications.systemNotifications.enabledLabel')}
                onCheckedChange={checked => onChangeSystemNotificationsEnabled(checked)}
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
          <SettingRow
            label={t('settingsPanel.notifications.agentStandbyBanner.enabledLabel')}
            description={t('settingsPanel.notifications.agentStandbyBanner.enabledHelp')}
            control={
              <Toggle
                data-testid="settings-agent-standby-banner-enabled"
                checked={standbyBannerEnabled}
                label={t('settingsPanel.notifications.agentStandbyBanner.enabledLabel')}
                onCheckedChange={checked => onChangeStandbyBannerEnabled(checked)}
              />
            }
          />

          <SettingsModule
            id="settings-standby-banner-context"
            title={t('settingsPanel.notifications.agentStandbyBanner.contextTitle')}
            description={t('settingsPanel.notifications.agentStandbyBanner.contextHelp')}
          >
            <SettingRow
              data-testid="settings-standby-banner-show-task"
              label={t('settingsPanel.notifications.agentStandbyBanner.showTask')}
              control={
                <Toggle
                  checked={standbyBannerShowTask}
                  disabled={!standbyBannerEnabled}
                  label={t('settingsPanel.notifications.agentStandbyBanner.showTask')}
                  onCheckedChange={checked => onChangeStandbyBannerShowTask(checked)}
                />
              }
            />

            <SettingRow
              data-testid="settings-standby-banner-show-space"
              label={t('settingsPanel.notifications.agentStandbyBanner.showSpace')}
              control={
                <Toggle
                  checked={standbyBannerShowSpace}
                  disabled={!standbyBannerEnabled}
                  label={t('settingsPanel.notifications.agentStandbyBanner.showSpace')}
                  onCheckedChange={checked => onChangeStandbyBannerShowSpace(checked)}
                />
              }
            />

            <SettingRow
              data-testid="settings-standby-banner-show-branch"
              label={t('settingsPanel.notifications.agentStandbyBanner.showBranch')}
              control={
                <Toggle
                  checked={standbyBannerShowBranch}
                  disabled={!standbyBannerEnabled}
                  label={t('settingsPanel.notifications.agentStandbyBanner.showBranch')}
                  onCheckedChange={checked => onChangeStandbyBannerShowBranch(checked)}
                />
              }
            />

            <SettingRow
              data-testid="settings-standby-banner-show-pr"
              label={t('settingsPanel.notifications.agentStandbyBanner.showPullRequest')}
              control={
                <Toggle
                  checked={standbyBannerShowPullRequest}
                  disabled={!standbyBannerEnabled || !githubPullRequestsEnabled}
                  label={t('settingsPanel.notifications.agentStandbyBanner.showPullRequest')}
                  onCheckedChange={checked => onChangeStandbyBannerShowPullRequest(checked)}
                />
              }
            />
          </SettingsModule>
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
