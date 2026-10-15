import React from 'react'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function IntegrationsSection(props: {
  githubPullRequestsEnabled: boolean
  onChangeGitHubPullRequestsEnabled: (enabled: boolean) => void
}): React.JSX.Element {
  const { githubPullRequestsEnabled, onChangeGitHubPullRequestsEnabled } = props
  const { t } = useTranslation()

  return (
    <SettingsGroup
      id="settings-section-integrations"
      title={t('settingsPanel.groups.integrations.github')}
    >
      <SettingsGroupBody>
        <div className="settings-panel__row" id="settings-github-pull-requests">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.integrations.githubPullRequestsLabel')}</strong>
            <span>{t('settingsPanel.integrations.githubPullRequestsHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <Toggle
              data-testid="settings-github-pull-requests-enabled"
              checked={githubPullRequestsEnabled}
              label={t('settingsPanel.integrations.githubPullRequestsLabel')}
              onCheckedChange={checked => onChangeGitHubPullRequestsEnabled(checked)}
            />
          </div>
        </div>
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
