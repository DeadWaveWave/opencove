import React from 'react'
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
              <label className="cove-toggle">
                <input
                  type="checkbox"
                  data-testid="settings-system-notifications-enabled"
                  checked={systemNotificationsEnabled}
                  aria-label={t('settingsPanel.notifications.systemNotifications.enabledLabel')}
                  onChange={event => onChangeSystemNotificationsEnabled(event.target.checked)}
                />
                <span className="cove-toggle__slider"></span>
              </label>
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
              <label className="cove-toggle">
                <input
                  type="checkbox"
                  data-testid="settings-agent-standby-banner-enabled"
                  checked={standbyBannerEnabled}
                  aria-label={t('settingsPanel.notifications.agentStandbyBanner.enabledLabel')}
                  onChange={event => onChangeStandbyBannerEnabled(event.target.checked)}
                />
                <span className="cove-toggle__slider"></span>
              </label>
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
                <label className="cove-toggle">
                  <input
                    type="checkbox"
                    checked={standbyBannerShowTask}
                    disabled={!standbyBannerEnabled}
                    aria-label={t('settingsPanel.notifications.agentStandbyBanner.showTask')}
                    onChange={event => onChangeStandbyBannerShowTask(event.target.checked)}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>
            </div>

            <div className="settings-panel__row" data-testid="settings-standby-banner-show-space">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.notifications.agentStandbyBanner.showSpace')}</strong>
              </div>
              <div className="settings-panel__control">
                <label className="cove-toggle">
                  <input
                    type="checkbox"
                    checked={standbyBannerShowSpace}
                    disabled={!standbyBannerEnabled}
                    aria-label={t('settingsPanel.notifications.agentStandbyBanner.showSpace')}
                    onChange={event => onChangeStandbyBannerShowSpace(event.target.checked)}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>
            </div>

            <div className="settings-panel__row" data-testid="settings-standby-banner-show-branch">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.notifications.agentStandbyBanner.showBranch')}</strong>
              </div>
              <div className="settings-panel__control">
                <label className="cove-toggle">
                  <input
                    type="checkbox"
                    checked={standbyBannerShowBranch}
                    disabled={!standbyBannerEnabled}
                    aria-label={t('settingsPanel.notifications.agentStandbyBanner.showBranch')}
                    onChange={event => onChangeStandbyBannerShowBranch(event.target.checked)}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>
            </div>

            <div className="settings-panel__row" data-testid="settings-standby-banner-show-pr">
              <div className="settings-panel__row-label">
                <strong>
                  {t('settingsPanel.notifications.agentStandbyBanner.showPullRequest')}
                </strong>
              </div>
              <div className="settings-panel__control">
                <label className="cove-toggle">
                  <input
                    type="checkbox"
                    checked={standbyBannerShowPullRequest}
                    disabled={!standbyBannerEnabled || !githubPullRequestsEnabled}
                    aria-label={t('settingsPanel.notifications.agentStandbyBanner.showPullRequest')}
                    onChange={event => onChangeStandbyBannerShowPullRequest(event.target.checked)}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>
            </div>
          </SettingsModule>
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
