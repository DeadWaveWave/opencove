import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalProfile } from '@shared/contracts/dto'

export interface TerminalProfileRowProps {
  defaultTerminalProfileId: string | null
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  onChangeDefaultTerminalProfileId: (profileId: string | null) => void
}

export function TerminalProfileRow({
  defaultTerminalProfileId,
  terminalProfiles,
  detectedDefaultTerminalProfileId,
  onChangeDefaultTerminalProfileId,
}: TerminalProfileRowProps) {
  const { t } = useTranslation()
  const selectedProfileId = terminalProfiles.some(
    profile => profile.id === defaultTerminalProfileId,
  )
    ? defaultTerminalProfileId
    : null
  const defaultProfileLabel =
    terminalProfiles.find(profile => profile.id === detectedDefaultTerminalProfileId)?.label ??
    t('settingsPanel.terminal.profileAuto')
  return (
    <div className="settings-panel__row">
      <div className="settings-panel__row-label">
        <strong>{t('settingsPanel.terminal.profileLabel')}</strong>
        <span>
          {t('settingsPanel.terminal.profileHelp', { defaultProfile: defaultProfileLabel })}
        </span>
      </div>
      <div className="settings-panel__control">
        <CoveSelect
          id="settings-terminal-profile"
          testId="settings-terminal-profile"
          ariaLabel={t('settingsPanel.terminal.profileLabel')}
          value={selectedProfileId ?? ''}
          options={[
            {
              value: '',
              label: t('settingsPanel.terminal.profileAutoWithDefault', {
                defaultProfile: defaultProfileLabel,
              }),
            },
            ...terminalProfiles.map(profile => ({ value: profile.id, label: profile.label })),
          ]}
          onChange={next => onChangeDefaultTerminalProfileId(next.trim().length > 0 ? next : null)}
        />
      </div>
    </div>
  )
}
