import React from 'react'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
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
        <SettingRow
          id="settings-github-pull-requests"
          label={t('settingsPanel.integrations.githubPullRequestsLabel')}
          description={t('settingsPanel.integrations.githubPullRequestsHelp')}
          control={
            <Toggle
              data-testid="settings-github-pull-requests-enabled"
              checked={githubPullRequestsEnabled}
              label={t('settingsPanel.integrations.githubPullRequestsLabel')}
              onCheckedChange={checked => onChangeGitHubPullRequestsEnabled(checked)}
            />
          }
        />
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
