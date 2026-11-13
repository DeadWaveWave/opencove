import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import { getStandardWindowSizeBucketLabel } from '@app/renderer/i18n/labels'
import {
  NODE_EXPAND_BEHAVIORS,
  STANDARD_WINDOW_SIZE_BUCKETS,
  type NodeExpandBehavior,
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
    <SettingRow
      label={t('settingsPanel.canvas.standardWindowSizeLabel')}
      description={t('settingsPanel.canvas.standardWindowSizeHelp')}
      control={
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
      }
    />
  )
}

export function WindowSizeSection(
  props: WindowSizeProps & {
    nodeExpandBehavior: NodeExpandBehavior
    onChangeNodeExpandBehavior: (behavior: NodeExpandBehavior) => void
  },
) {
  const { t } = useTranslation()
  return (
    <SettingsGroup
      id="settings-section-window-size"
      title={t('settingsPanel.groups.canvasWindows.windowTerminal')}
    >
      <SettingsGroupBody>
        <WindowSizeRow {...props} />
        <SettingRow
          label={t('settingsPanel.canvas.nodeExpandBehaviorLabel')}
          description={t('settingsPanel.canvas.nodeExpandBehaviorHelp')}
          control={
            <CoveSelect
              id="settings-node-expand-behavior"
              testId="settings-node-expand-behavior"
              ariaLabel={t('settingsPanel.canvas.nodeExpandBehaviorLabel')}
              value={props.nodeExpandBehavior}
              options={NODE_EXPAND_BEHAVIORS.map(behavior => ({
                value: behavior,
                label: t(`settingsPanel.canvas.nodeExpandBehavior.${behavior}`),
              }))}
              onChange={value => {
                if (value === 'push-away' || value === 'find-space') {
                  props.onChangeNodeExpandBehavior(value)
                }
              }}
            />
          }
        />
      </SettingsGroupBody>
    </SettingsGroup>
  )
}

/** Composition for callers that still render the two existing rows together. */
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
