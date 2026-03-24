import React from 'react'
import { useTranslation } from '@app/renderer/i18n'

export function NotificationsSection(props: {
  standbyBannerEnabled: boolean
  standbyBannerShowTask: boolean
  standbyBannerShowSpace: boolean
  standbyBannerShowBranch: boolean
  standbyBannerShowPullRequest: boolean
  githubPullRequestsEnabled: boolean
  onChangeStandbyBannerEnabled: (enabled: boolean) => void
  onChangeStandbyBannerShowTask: (enabled: boolean) => void
  onChangeStandbyBannerShowSpace: (enabled: boolean) => void
  onChangeStandbyBannerShowBranch: (enabled: boolean) => void
  onChangeStandbyBannerShowPullRequest: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    standbyBannerEnabled,
    standbyBannerShowTask,
    standbyBannerShowSpace,
    standbyBannerShowBranch,
    standbyBannerShowPullRequest,
    githubPullRequestsEnabled,
    onChangeStandbyBannerEnabled,
    onChangeStandbyBannerShowTask,
    onChangeStandbyBannerShowSpace,
    onChangeStandbyBannerShowBranch,
    onChangeStandbyBannerShowPullRequest,
  } = props

  return (
    <div className="settings-panel__section" id="settings-section-notifications">
      <h3 className="settings-panel__section-title">{t('settingsPanel.notifications.title')}</h3>

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
              onChange={event => onChangeStandbyBannerEnabled(event.target.checked)}
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <strong>{t('settingsPanel.notifications.agentStandbyBanner.contextTitle')}</strong>
          <span>{t('settingsPanel.notifications.agentStandbyBanner.contextHelp')}</span>
        </div>

        <div className="settings-list-container">
          <div className="settings-list-item" data-testid="settings-standby-banner-show-task">
            <div className="settings-list-item__left">
              {t('settingsPanel.notifications.agentStandbyBanner.showTask')}
            </div>
            <label className="cove-toggle">
              <input
                type="checkbox"
                checked={standbyBannerShowTask}
                disabled={!standbyBannerEnabled}
                onChange={event => onChangeStandbyBannerShowTask(event.target.checked)}
              />
              <span className="cove-toggle__slider"></span>
            </label>
          </div>

          <div className="settings-list-item" data-testid="settings-standby-banner-show-space">
            <div className="settings-list-item__left">
              {t('settingsPanel.notifications.agentStandbyBanner.showSpace')}
            </div>
            <label className="cove-toggle">
              <input
                type="checkbox"
                checked={standbyBannerShowSpace}
                disabled={!standbyBannerEnabled}
                onChange={event => onChangeStandbyBannerShowSpace(event.target.checked)}
              />
              <span className="cove-toggle__slider"></span>
            </label>
          </div>

          <div className="settings-list-item" data-testid="settings-standby-banner-show-branch">
            <div className="settings-list-item__left">
              {t('settingsPanel.notifications.agentStandbyBanner.showBranch')}
            </div>
            <label className="cove-toggle">
              <input
                type="checkbox"
                checked={standbyBannerShowBranch}
                disabled={!standbyBannerEnabled}
                onChange={event => onChangeStandbyBannerShowBranch(event.target.checked)}
              />
              <span className="cove-toggle__slider"></span>
            </label>
          </div>

          <div className="settings-list-item" data-testid="settings-standby-banner-show-pr">
            <div className="settings-list-item__left">
              {t('settingsPanel.notifications.agentStandbyBanner.showPullRequest')}
            </div>
            <label className="cove-toggle">
              <input
                type="checkbox"
                checked={standbyBannerShowPullRequest}
                disabled={!standbyBannerEnabled || !githubPullRequestsEnabled}
                onChange={event => onChangeStandbyBannerShowPullRequest(event.target.checked)}
              />
              <span className="cove-toggle__slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
