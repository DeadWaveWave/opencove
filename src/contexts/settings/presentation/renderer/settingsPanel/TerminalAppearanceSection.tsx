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
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.general.terminalFontSize')}</strong>
              <span>{t('settingsPanel.appearance.terminalFontSizeHelp')}</span>
            </div>
            <div className="settings-panel__control settings-type-size-control">
              <input
                id="settings-terminal-font-size"
                data-testid="settings-terminal-font-size"
                className="cove-field"
                type="number"
                aria-label={t('settingsPanel.general.terminalFontSize')}
                min={MIN_TERMINAL_FONT_SIZE}
                max={MAX_TERMINAL_FONT_SIZE}
                value={props.terminalFontSize}
                onChange={event => props.onChangeTerminalFontSize(Number(event.target.value))}
              />
              <span>{t('common.pixelUnit')}</span>
            </div>
          </div>
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong id="settings-terminal-background-label">
                {t('settingsPanel.appearanceNext.terminalBackground')}
              </strong>
              <span>{t('settingsPanel.appearanceNext.terminalBackgroundHelp')}</span>
            </div>
            <div className="settings-panel__control">
              <SegmentedControl
                testId="settings-terminal-background"
                labelledBy="settings-terminal-background-label"
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
            </div>
          </div>
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
