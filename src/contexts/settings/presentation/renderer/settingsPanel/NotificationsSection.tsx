import React from 'react'
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
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.notifications.systemNotifications.enabledLabel')}</strong>
              <span>{t('settingsPanel.notifications.systemNotifications.enabledHelp')}</span>
            </div>
            <div className="settings-panel__control">
              <Toggle
                data-testid="settings-system-notifications-enabled"
                checked={systemNotificationsEnabled}
                label={t('settingsPanel.notifications.systemNotifications.enabledLabel')}
                onCheckedChange={checked => onChangeSystemNotificationsEnabled(checked)}
              />
            </div>
          </div>
        </SettingsGroupBody>
      </SettingsGroup>

      <SettingsGroup
        id="settings-section-standby-banner"
        title={t('settingsPanel.groups.notifications.standby')}
      >
        <SettingsGroupBody>
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.notifications.agentStandbyBanner.enabledLabel')}</strong>
              <span>{t('settingsPanel.notifications.agentStandbyBanner.enabledHelp')}</span>
            </div>
            <div className="settings-panel__control">
              <Toggle
                data-testid="settings-agent-standby-banner-enabled"
                checked={standbyBannerEnabled}
                label={t('settingsPanel.notifications.agentStandbyBanner.enabledLabel')}
                onCheckedChange={checked => onChangeStandbyBannerEnabled(checked)}
              />
            </div>
          </div>

          <SettingsModule
            id="settings-standby-banner-context"
            title={t('settingsPanel.notifications.agentStandbyBanner.contextTitle')}
            description={t('settingsPanel.notifications.agentStandbyBanner.contextHelp')}
          >
            <div className="settings-panel__row" data-testid="settings-standby-banner-show-task">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.notifications.agentStandbyBanner.showTask')}</strong>
              </div>
              <div className="settings-panel__control">
                <Toggle
                  checked={standbyBannerShowTask}
                  disabled={!standbyBannerEnabled}
                  label={t('settingsPanel.notifications.agentStandbyBanner.showTask')}
                  onCheckedChange={checked => onChangeStandbyBannerShowTask(checked)}
                />
              </div>
            </div>

            <div className="settings-panel__row" data-testid="settings-standby-banner-show-space">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.notifications.agentStandbyBanner.showSpace')}</strong>
              </div>
              <div className="settings-panel__control">
                <Toggle
                  checked={standbyBannerShowSpace}
                  disabled={!standbyBannerEnabled}
                  label={t('settingsPanel.notifications.agentStandbyBanner.showSpace')}
                  onCheckedChange={checked => onChangeStandbyBannerShowSpace(checked)}
                />
              </div>
            </div>

            <div className="settings-panel__row" data-testid="settings-standby-banner-show-branch">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.notifications.agentStandbyBanner.showBranch')}</strong>
              </div>
              <div className="settings-panel__control">
                <Toggle
                  checked={standbyBannerShowBranch}
                  disabled={!standbyBannerEnabled}
                  label={t('settingsPanel.notifications.agentStandbyBanner.showBranch')}
                  onCheckedChange={checked => onChangeStandbyBannerShowBranch(checked)}
                />
              </div>
            </div>

            <div className="settings-panel__row" data-testid="settings-standby-banner-show-pr">
              <div className="settings-panel__row-label">
                <strong>
                  {t('settingsPanel.notifications.agentStandbyBanner.showPullRequest')}
                </strong>
              </div>
              <div className="settings-panel__control">
                <Toggle
                  checked={standbyBannerShowPullRequest}
                  disabled={!standbyBannerEnabled || !githubPullRequestsEnabled}
                  label={t('settingsPanel.notifications.agentStandbyBanner.showPullRequest')}
                  onCheckedChange={checked => onChangeStandbyBannerShowPullRequest(checked)}
                />
              </div>
            </div>
          </SettingsModule>
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
