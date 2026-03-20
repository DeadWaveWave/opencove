import React from 'react'
import { useTranslation } from '@app/renderer/i18n'

export function IntegrationsSection(props: {
  githubPullRequestsEnabled: boolean
  onChangeGitHubPullRequestsEnabled: (enabled: boolean) => void
}): React.JSX.Element {
  const { githubPullRequestsEnabled, onChangeGitHubPullRequestsEnabled } = props
  const { t } = useTranslation()

  return (
    <div className="settings-panel__section" id="settings-section-integrations">
      <h3 className="settings-panel__section-title">{t('settingsPanel.integrations.title')}</h3>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.integrations.githubPullRequestsLabel')}</strong>
          <span>{t('settingsPanel.integrations.githubPullRequestsHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-github-pull-requests-enabled"
              checked={githubPullRequestsEnabled}
              onChange={event => onChangeGitHubPullRequestsEnabled(event.target.checked)}
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>
    </div>
  )
}
