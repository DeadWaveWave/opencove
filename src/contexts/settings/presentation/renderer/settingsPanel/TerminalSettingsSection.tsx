import { useTranslation } from '@app/renderer/i18n'
import {
  TerminalAppearanceSection,
  TerminalCalibrationSection,
  type TerminalAppearanceSectionProps,
} from './TerminalAppearanceSection'
import { TerminalProfileRow, type TerminalProfileRowProps } from './TerminalProfileRow'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export type TerminalSettingsSectionProps = TerminalAppearanceSectionProps & TerminalProfileRowProps

export function TerminalSettingsSection(props: TerminalSettingsSectionProps) {
  const { t } = useTranslation()
  return (
    <>
      <TerminalAppearanceSection {...props} />
      {props.terminalProfiles.length > 0 ? (
        <SettingsGroup
          id="settings-section-terminal-profile"
          title={t('settingsPanel.appearanceNext.terminalShell')}
        >
          <SettingsGroupBody>
            <TerminalProfileRow {...props} />
          </SettingsGroupBody>
        </SettingsGroup>
      ) : null}
      <TerminalCalibrationSection {...props} />
    </>
  )
}
