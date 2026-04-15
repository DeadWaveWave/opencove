import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { QuickCommand, QuickPhrase } from '@contexts/settings/domain/agentSettings'
import { QuickCommandsSubsection } from './quickMenu/QuickCommandsSubsection'
import { QuickPhrasesSubsection } from './quickMenu/QuickPhrasesSubsection'

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
    <div
      className="settings-panel__section settings-panel__section--vertical"
      id="settings-section-quick-menu"
    >
      <h3 className="settings-panel__section-title">{t('settingsPanel.quickMenu.title')}</h3>
      <QuickCommandsSubsection
        quickCommands={quickCommands}
        onChangeQuickCommands={onChangeQuickCommands}
      />
      <QuickPhrasesSubsection
        quickPhrases={quickPhrases}
        onChangeQuickPhrases={onChangeQuickPhrases}
      />
    </div>
  )
}
