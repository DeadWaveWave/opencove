import React from 'react'
import { useTranslation } from '@app/renderer/i18n'

export interface SettingsSection<SectionId extends string> {
  id: SectionId
  title: string
  anchorId: string
}

export function SettingsPanelNav<SectionId extends string>(props: {
  sections: Array<SettingsSection<SectionId>>
  activeSectionId: SectionId
  onSelect: (section: SettingsSection<SectionId>) => void
}): React.JSX.Element {
  const { sections, activeSectionId, onSelect } = props
  const { t } = useTranslation()

  return (
    <aside className="settings-panel__sidebar" aria-label={t('settingsPanel.nav.sectionsLabel')}>
      {sections.map(section => {
        const isActive = section.id === activeSectionId

        return (
          <button
            key={section.id}
            type="button"
            className={`settings-panel__nav-button${isActive ? ' settings-panel__nav-button--active' : ''}`}
            data-testid={`settings-section-nav-${section.id}`}
            onClick={() => {
              onSelect(section)
            }}
          >
            {section.title}
          </button>
        )
      })}
    </aside>
  )
}
