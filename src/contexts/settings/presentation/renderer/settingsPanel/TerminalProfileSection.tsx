import React from 'react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalProfile } from '@shared/contracts/dto'

export function TerminalProfileSection({
  defaultTerminalProfileId,
  terminalProfiles,
  detectedDefaultTerminalProfileId,
  onChangeDefaultTerminalProfileId,
}: {
  defaultTerminalProfileId: string | null
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  onChangeDefaultTerminalProfileId: (profileId: string | null) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const selectedProfileId = terminalProfiles.some(
    profile => profile.id === defaultTerminalProfileId,
  )
    ? defaultTerminalProfileId
    : null
  const defaultProfileLabel =
    terminalProfiles.find(profile => profile.id === detectedDefaultTerminalProfileId)?.label ??
    t('settingsPanel.terminal.profileAuto')

  if (terminalProfiles.length === 0) {
    return null
  }

  return (
    <div className="settings-panel__section" id="settings-section-terminal-profile">
      <h3 className="settings-panel__section-title">{t('settingsPanel.terminal.title')}</h3>
      <span className="settings-panel__section-help">{t('settingsPanel.terminal.help')}</span>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.terminal.profileLabel')}</strong>
          <span>
            {t('settingsPanel.terminal.profileHelp', {
              defaultProfile: defaultProfileLabel,
            })}
          </span>
        </div>
        <div className="settings-panel__control">
          <CoveSelect
            id="settings-terminal-profile"
            testId="settings-terminal-profile"
            value={selectedProfileId ?? ''}
            options={[
              {
                value: '',
                label: t('settingsPanel.terminal.profileAutoWithDefault', {
                  defaultProfile: defaultProfileLabel,
                }),
              },
              ...terminalProfiles.map(profile => ({
                value: profile.id,
                label: profile.label,
              })),
            ]}
            onChange={nextValue =>
              onChangeDefaultTerminalProfileId(nextValue.trim().length > 0 ? nextValue : null)
            }
          />
        </div>
      </div>
    </div>
  )
}
