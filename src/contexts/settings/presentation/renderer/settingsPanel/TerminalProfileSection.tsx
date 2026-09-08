import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import { getStandardWindowSizeBucketLabel } from '@app/renderer/i18n/labels'
import {
  STANDARD_WINDOW_SIZE_BUCKETS,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'
import { TerminalProfileRow, type TerminalProfileRowProps } from './TerminalProfileRow'

interface WindowSizeProps {
  standardWindowSizeBucket: StandardWindowSizeBucket
  onChangeStandardWindowSizeBucket: (bucket: StandardWindowSizeBucket) => void
}

function WindowSizeRow({
  standardWindowSizeBucket,
  onChangeStandardWindowSizeBucket,
}: WindowSizeProps) {
  const { t } = useTranslation()
  return (
    <div className="settings-panel__row">
      <div className="settings-panel__row-label">
        <strong>{t('settingsPanel.canvas.standardWindowSizeLabel')}</strong>
        <span>{t('settingsPanel.canvas.standardWindowSizeHelp')}</span>
      </div>
      <div className="settings-panel__control">
        <CoveSelect
          id="settings-standard-window-size"
          testId="settings-standard-window-size"
          ariaLabel={t('settingsPanel.canvas.standardWindowSizeLabel')}
          value={standardWindowSizeBucket}
          options={STANDARD_WINDOW_SIZE_BUCKETS.map(bucket => ({
            value: bucket,
            label: getStandardWindowSizeBucketLabel(t, bucket),
          }))}
          onChange={next => onChangeStandardWindowSizeBucket(next as StandardWindowSizeBucket)}
        />
      </div>
    </div>
  )
}

export function WindowSizeSection(props: WindowSizeProps) {
  const { t } = useTranslation()
  return (
    <SettingsGroup
      id="settings-section-window-size"
      title={t('settingsPanel.groups.canvasWindows.windowTerminal')}
    >
      <SettingsGroupBody>
        <WindowSizeRow {...props} />
      </SettingsGroupBody>
    </SettingsGroup>
  )
}

/** Compatibility composition for callers that still render the two existing rows together. */
export function TerminalProfileSection(props: WindowSizeProps & TerminalProfileRowProps) {
  const { t } = useTranslation()
  return (
    <SettingsGroup
      id="settings-section-terminal-profile"
      title={t('settingsPanel.groups.canvasWindows.windowTerminal')}
    >
      <SettingsGroupBody>
        <WindowSizeRow {...props} />
        {props.terminalProfiles.length > 0 ? <TerminalProfileRow {...props} /> : null}
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
