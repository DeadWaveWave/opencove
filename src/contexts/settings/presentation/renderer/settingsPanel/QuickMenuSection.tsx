import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { QuickCommand, QuickPhrase } from '@contexts/settings/domain/agentSettings'
import { QuickCommandsSubsection } from './quickMenu/QuickCommandsSubsection'
import { QuickPhrasesSubsection } from './quickMenu/QuickPhrasesSubsection'
import { SettingsGroup } from './SettingsGroup'

export function QuickMenuSection({
  quickCommands,
  quickPhrases,
  onChangeQuickCommands,
  onChangeQuickPhrases,
}: {
  quickCommands: QuickCommand[]
  quickPhrases: QuickPhrase[]
  onChangeQuickCommands: (commands: QuickCommand[]) => void
  onChangeQuickPhrases: (phrases: QuickPhrase[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <SettingsGroup
      id="settings-section-quick-menu"
      title={t('settingsPanel.groups.tasksShortcuts.quickActions')}
    >
      <QuickCommandsSubsection
        quickCommands={quickCommands}
        onChangeQuickCommands={onChangeQuickCommands}
      />
      <QuickPhrasesSubsection
        quickPhrases={quickPhrases}
        onChangeQuickPhrases={onChangeQuickPhrases}
      />
    </SettingsGroup>
  )
}
