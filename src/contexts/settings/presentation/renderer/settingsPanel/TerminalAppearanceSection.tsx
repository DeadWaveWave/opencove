import { NumberInput } from '@app/renderer/components/ui/NumberInput'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { useTranslation } from '@app/renderer/i18n'
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  type TerminalDisplayReference,
} from '@contexts/settings/domain/agentSettings'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import type { TerminalBackgroundMode } from '@contexts/settings/domain/terminalBackgroundSettings'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'
import { TerminalFontFamilyRow } from './TerminalFontFamilyRow'
import { TerminalDisplayCalibrationRow } from './TerminalDisplayCalibrationRow'
import { TerminalTypographyPreview } from './TerminalTypographyPreview'

export interface TerminalAppearanceSectionProps {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalBackground: TerminalBackgroundMode
  terminalDisplayAutoReferenceEnabled: boolean
  terminalDisplayCalibrationCompensationEnabled: boolean
  terminalDisplayReference: TerminalDisplayReference | null
  onChangeTerminalFontSize: (size: number) => void
  onChangeTerminalFontFamily: (family: string | null) => void
  onChangeTerminalBackground: (mode: TerminalBackgroundMode) => void
  onChangeTerminalDisplayAutoReferenceEnabled: (enabled: boolean) => void
  onChangeTerminalDisplayCalibrationCompensationEnabled: (enabled: boolean) => void
  onChangeTerminalDisplayReference: (reference: TerminalDisplayReference | null) => void
}

export function TerminalAppearanceSection(props: TerminalAppearanceSectionProps) {
  const { t } = useTranslation()
  return (
    <>
      <SettingsGroup
        id="settings-section-terminal-appearance"
        title={t('settingsPanel.appearanceNext.terminalTypography')}
        description={t('settingsPanel.appearanceNext.terminalTypographyHelp')}
      >
        <SettingsGroupBody>
          <TerminalTypographyPreview
            fontFamily={props.terminalFontFamily}
            fontSize={props.terminalFontSize}
          />
          <TerminalFontFamilyRow
            terminalFontFamily={props.terminalFontFamily}
            onChangeTerminalFontFamily={props.onChangeTerminalFontFamily}
          />
          <SettingRow
            label={t('settingsPanel.general.terminalFontSize')}
            description={t('settingsPanel.appearance.terminalFontSizeHelp')}
            control={
              <NumberInput
                id="settings-terminal-font-size"
                data-testid="settings-terminal-font-size"
                min={MIN_TERMINAL_FONT_SIZE}
                max={MAX_TERMINAL_FONT_SIZE}
                value={props.terminalFontSize}
                onChange={event => props.onChangeTerminalFontSize(Number(event.target.value))}
                unit={t('common.pixelUnit')}
              />
            }
          />
          <SettingRow
            label={t('settingsPanel.appearanceNext.terminalBackground')}
            description={t('settingsPanel.appearanceNext.terminalBackgroundHelp')}
            control={
              <SegmentedControl
                id="settings-terminal-background"
                testId="settings-terminal-background"
                value={props.terminalBackground}
                options={[
                  {
                    value: 'auto',
                    label: t('settingsPanel.appearanceNext.terminalBackgroundAuto'),
                    testId: 'settings-terminal-background-auto',
                  },
                  {
                    value: 'transparent',
                    label: t('settingsPanel.appearanceNext.terminalBackgroundTransparent'),
                    testId: 'settings-terminal-background-transparent',
                  },
                  {
                    value: 'opaque',
                    label: t('settingsPanel.appearanceNext.terminalBackgroundOpaque'),
                    testId: 'settings-terminal-background-opaque',
                  },
                ]}
                onValueChange={props.onChangeTerminalBackground}
              />
            }
          />
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}

export function TerminalCalibrationSection(props: TerminalAppearanceSectionProps) {
  const { t } = useTranslation()
  return (
    <details
      className="settings-terminal-calibration"
      data-testid="settings-terminal-calibration-disclosure"
    >
      <summary>
        <span>{t('settingsPanel.appearanceNext.calibration')}</span>
        <small>{t('settingsPanel.appearanceNext.calibrationHelp')}</small>
      </summary>
      <div className="settings-terminal-calibration__content">
        <TerminalDisplayCalibrationRow
          terminalFontSize={props.terminalFontSize}
          terminalFontFamily={props.terminalFontFamily}
          terminalDisplayAutoReferenceEnabled={props.terminalDisplayAutoReferenceEnabled}
          terminalDisplayCalibrationCompensationEnabled={
            props.terminalDisplayCalibrationCompensationEnabled
          }
          terminalDisplayReference={props.terminalDisplayReference}
          onChangeTerminalDisplayAutoReferenceEnabled={
            props.onChangeTerminalDisplayAutoReferenceEnabled
          }
          onChangeTerminalDisplayCalibrationCompensationEnabled={
            props.onChangeTerminalDisplayCalibrationCompensationEnabled
          }
          onChangeTerminalDisplayReference={props.onChangeTerminalDisplayReference}
        />
      </div>
    </details>
  )
}
